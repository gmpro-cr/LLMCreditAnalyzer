# HITL + Confidence Scoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add High/Medium/Low confidence indicators to every AI-generated CAM section, enforce RM review before export, and block export until all Low-confidence items are resolved.

**Architecture:** The Python service assigns a deterministic confidence level to each section based on available data quality. The frontend renders colored badges per section, shows "Mark as Reviewed" buttons for Medium, requires edit-or-verify for Low, and blocks the Export DOCX button until all Low items are cleared.

**Tech Stack:** Python (cam_sections.py), Next.js API routes (TypeScript), React (CamNoteEditor.tsx)

---

## Data Model

Current section shape:
```json
{ "content": "...", "user_edited": false, "ai_generated": true }
```

New section shape (backwards-compatible):
```json
{
  "content": "...",
  "user_edited": false,
  "ai_generated": true,
  "confidence": "medium",
  "confidence_reason": "Inferred from financial data; some interpretation applied",
  "reviewed": false,
  "low_verified": false
}
```

No DB schema changes needed — sections are stored as JSON inside `extracted_data.cam_sections`.

---

## Confidence Rules

| Section | Default Confidence | Reason |
|---|---|---|
| company_background | high (if company_info.name present) / medium | Extracted directly from structured data |
| group_structure | medium | Inferred; standalone fallback if no group data |
| management_profile | medium | Requires KYC not always in upload |
| business_model | medium | Semi-structured inference |
| industry_analysis | medium | Sector KB + research brief, not borrower-specific |
| key_issues | medium | Synthesized from ratios + inference |
| recommendation | low | Scaffold only — must be RM-authored |

---

## Task 1: Python — Add confidence scoring to `cam_sections.py`

**Files:**
- Modify: `python-service/cam_sections.py` (lines 295–370, `generate_cam_sections` function)

**Step 1: Add confidence rules dict above `generate_cam_sections`**

```python
# ── Confidence rules ──────────────────────────────────────────────────────────

SECTION_CONFIDENCE: Dict[str, tuple] = {
    # key: (default_confidence, reason)
    "company_background":  ("high",   "Extracted directly from structured company data"),
    "group_structure":     ("medium", "Inferred from available data; verify with MCA"),
    "management_profile":  ("medium", "Based on available promoter data; KYC verification required"),
    "business_model":      ("medium", "Inferred from financials and research; verify key claims"),
    "industry_analysis":   ("medium", "Drawn from sector knowledge base and web research"),
    "key_issues":          ("medium", "Synthesized from ratios and research; RM judgement required"),
    "recommendation":      ("low",    "AI scaffold only — recommendation MUST be written by RM"),
}


def _resolve_confidence(section_key: str, financials: Dict) -> tuple:
    """
    Returns (confidence, reason) for a section.
    Downgrades company_background to 'medium' if company_info is sparse.
    """
    confidence, reason = SECTION_CONFIDENCE.get(section_key, ("medium", "AI-generated content"))
    if section_key == "company_background":
        ci = financials.get("company_info", {})
        if not ci.get("name") and not ci.get("description"):
            return ("medium", "Company info sparse — verify background details")
    return (confidence, reason)
```

**Step 2: Update `generate_cam_sections` to attach confidence fields**

Find the loop at line ~334:
```python
    for key in AI_SECTIONS:
        content = batch.get(key, "")
        if not content:
            logger.info(f"[CAM] Batch missed section '{key}', generating individually")
            content = _draft_section(key, context_text, company_name)
        sections[key] = {
            "content": content,
            "user_edited": False,
            "ai_generated": True,
        }
```

Replace with:
```python
    for key in AI_SECTIONS:
        content = batch.get(key, "")
        if not content:
            logger.info(f"[CAM] Batch missed section '{key}', generating individually")
            content = _draft_section(key, context_text, company_name)
        conf, reason = _resolve_confidence(key, financials)
        sections[key] = {
            "content":           content,
            "user_edited":       False,
            "ai_generated":      True,
            "confidence":        conf,
            "confidence_reason": reason,
            "reviewed":          False,
            "low_verified":      False,
        }
```

**Step 3: Also update single-section regeneration path (line ~318):**

```python
    if regenerate and regenerate in AI_SECTIONS:
        content = _draft_section(regenerate, context_text, company_name)
        conf, reason = _resolve_confidence(regenerate, financials)
        return {
            regenerate: {
                "content":           content,
                "user_edited":       False,
                "ai_generated":      True,
                "confidence":        conf,
                "confidence_reason": reason,
                "reviewed":          False,
                "low_verified":      False,
            }
        }
```

**Step 4: Verify manually**

Run the Python service and call the draft-sections endpoint:
```bash
cd python-service && python -c "
from cam_sections import generate_cam_sections
sections = generate_cam_sections({'company_info': {'name': 'Test Co'}}, {}, 'Test Co')
for k, v in sections.items():
    if isinstance(v, dict) and 'confidence' in v:
        print(k, '->', v['confidence'], '|', v.get('confidence_reason',''))
"
```
Expected output: each AI section printed with its confidence level and reason.

**Step 5: Commit**
```bash
cd /Users/gaurav/creditguardai
git add python-service/cam_sections.py
git commit -m "feat: add confidence scoring to CAM section generation"
```

---

## Task 2: TypeScript — Update `TextSection` interface in `CamNoteEditor.tsx`

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx` (lines 10–18)

**Step 1: Add confidence fields to `TextSection` interface**

Current (lines 10–18):
```typescript
interface TextSection {
  content: string
  user_edited: boolean
  ai_generated?: boolean
  pep_checked?: boolean
  pep_notes?: string
}
```

Replace with:
```typescript
type ConfidenceLevel = 'high' | 'medium' | 'low'

interface TextSection {
  content: string
  user_edited: boolean
  ai_generated?: boolean
  pep_checked?: boolean
  pep_notes?: string
  confidence?: ConfidenceLevel
  confidence_reason?: string
  reviewed?: boolean
  low_verified?: boolean
}
```

**Step 2: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add confidence types to CamNoteEditor TextSection interface"
```

---

## Task 3: Frontend — `ConfidenceBadge` component

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add `ConfidenceBadge` component** after the `fmt` helper (around line 95):

```typescript
// ── Confidence Badge ────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<ConfidenceLevel, {
  bg: string; border: string; dot: string; text: string; label: string
}> = {
  high:   { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E', text: '#15803D', label: 'High Confidence' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B', text: '#92400E', label: 'Medium — Review Required' },
  low:    { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444', text: '#991B1B', label: 'Low — Edit or Verify' },
}

function ConfidenceBadge({
  level,
  reason,
  compact = false,
}: {
  level: ConfidenceLevel
  reason?: string
  compact?: boolean
}) {
  const s = CONFIDENCE_STYLES[level]
  return (
    <div
      title={reason}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full cursor-default"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      <span className="text-[10px] font-semibold tracking-wide" style={{ color: s.text }}>
        {compact ? level.toUpperCase() : s.label}
      </span>
    </div>
  )
}
```

**Step 2: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add ConfidenceBadge component to CAM editor"
```

---

## Task 4: Frontend — Review workflow in `TextSectionEditor`

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx` (lines 404–489, `TextSectionEditor` component)

**Step 1: Update `TextSectionEditor` props** to accept `onMarkReviewed` and `onVerifyLow`:

Find the component signature (line ~406):
```typescript
function TextSectionEditor({
  sectionKey,
  section,
  onChange,
  onRegenerate,
  isRegenerating,
}: {
  sectionKey: string
  section: TextSection
  onChange: (updated: TextSection) => void
  onRegenerate?: () => void
  isRegenerating?: boolean
})
```

Replace with:
```typescript
function TextSectionEditor({
  sectionKey,
  section,
  onChange,
  onRegenerate,
  isRegenerating,
  onMarkReviewed,
  onVerifyLow,
}: {
  sectionKey: string
  section: TextSection
  onChange: (updated: TextSection) => void
  onRegenerate?: () => void
  isRegenerating?: boolean
  onMarkReviewed?: () => void
  onVerifyLow?: () => void
})
```

**Step 2: Add review UI inside `TextSectionEditor`** — add this block right before the closing `</div>` of the component (after the `onRegenerate` block, around line 488):

```typescript
      {/* Confidence + HITL review row */}
      {section.ai_generated && section.confidence && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{
            background: section.confidence === 'low' ? '#FEF2F2' : section.confidence === 'medium' ? '#FFFBEB' : '#F0FDF4',
            border: `1px solid ${section.confidence === 'low' ? '#FECACA' : section.confidence === 'medium' ? '#FDE68A' : '#BBF7D0'}`,
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ConfidenceBadge level={section.confidence as ConfidenceLevel} reason={section.confidence_reason} />
            {section.confidence_reason && (
              <span className="text-[11px] text-muted-foreground truncate">{section.confidence_reason}</span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {section.confidence === 'medium' && !section.reviewed && !section.user_edited && (
              <button
                onClick={onMarkReviewed}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: '#F59E0B', color: '#fff' }}
              >
                <CheckCircle className="h-3.5 w-3.5" /> Mark as Reviewed
              </button>
            )}
            {section.confidence === 'medium' && (section.reviewed || section.user_edited) && (
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#15803D' }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {section.user_edited ? 'Edited by RM' : 'Reviewed'}
              </span>
            )}
            {section.confidence === 'low' && !section.user_edited && !section.low_verified && (
              <button
                onClick={onVerifyLow}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: '#EF4444', color: '#fff' }}
              >
                <AlertCircle className="h-3.5 w-3.5" /> Verify Anyway
              </button>
            )}
            {section.confidence === 'low' && (section.user_edited || section.low_verified) && (
              <span className="flex items-center gap-1 text-xs font-medium" style={{ color: '#15803D' }}>
                <CheckCircle className="h-3.5 w-3.5" />
                {section.user_edited ? 'Edited by RM' : 'Verified'}
              </span>
            )}
          </div>
        </div>
      )}
```

**Step 3: Wire `onMarkReviewed` and `onVerifyLow` in the main editor render loop**

In the main `CamNoteEditor` return block, find where `TextSectionEditor` is rendered (around line 780+) and add the two handlers:

```typescript
<TextSectionEditor
  sectionKey={activeSection}
  section={sec as TextSection}
  onChange={data => updateSection(activeSection, data)}
  onRegenerate={AI_SECTION_KEYS.includes(activeSection) ? () => handleRegenerateSection(activeSection) : undefined}
  isRegenerating={regeneratingSections.has(activeSection)}
  onMarkReviewed={() => updateSection(activeSection, { ...(sec as TextSection), reviewed: true })}
  onVerifyLow={() => updateSection(activeSection, { ...(sec as TextSection), low_verified: true })}
/>
```

**Step 4: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add HITL review workflow to TextSectionEditor (Medium/Low confidence)"
```

---

## Task 5: Frontend — Export gate

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx` (export section, around line 586)

**Step 1: Add `computeExportReadiness` helper** after `buildDocxContent`:

```typescript
function computeExportReadiness(sections: CamSections): {
  blockers: string[]
  warnings: string[]
} {
  const blockers: string[] = []
  const warnings: string[] = []

  for (const key of AI_SECTION_KEYS) {
    const sec = sections[key] as TextSection | undefined
    if (!sec || !sec.ai_generated) continue

    const conf = sec.confidence as ConfidenceLevel | undefined
    if (conf === 'low' && !sec.user_edited && !sec.low_verified) {
      const label = SECTION_META[key]?.label ?? key
      blockers.push(`"${label}" is Low confidence — edit it or click Verify Anyway`)
    }
    if (conf === 'medium' && !sec.reviewed && !sec.user_edited) {
      const label = SECTION_META[key]?.label ?? key
      warnings.push(`"${label}" has not been reviewed`)
    }
  }

  return { blockers, warnings }
}
```

**Step 2: Use `computeExportReadiness` in `handleExportDocx`**

Replace the current `handleExportDocx`:
```typescript
  const handleExportDocx = async () => {
    const { blockers } = computeExportReadiness(sections)
    if (blockers.length > 0) {
      alert(`Cannot export — resolve these issues first:\n\n• ${blockers.join('\n• ')}`)
      return
    }
    setExportingDocx(true)
    try {
      const content = buildDocxContent()
      const res = await fetch('/api/python-proxy/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_content: content, company_name: companyName }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/\s+/g, '_')}_FY${financialYear}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingDocx(false)
    }
  }
```

**Step 3: Update Export button to show blocker count badge**

Find the Export button in the top bar (around line 705):
```typescript
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportDocx}
            disabled={exportingDocx}
            className="text-xs font-medium"
          >
            {exportingDocx ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Export .docx
          </Button>
```

Replace with:
```typescript
          {(() => {
            const { blockers, warnings } = computeExportReadiness(sections)
            const blocked = blockers.length > 0
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportDocx}
                disabled={exportingDocx}
                className="text-xs font-medium relative"
                style={blocked ? { borderColor: '#EF4444', color: '#991B1B' } : undefined}
                title={blocked ? blockers.join('\n') : warnings.length > 0 ? `${warnings.length} section(s) unreviewed` : undefined}
              >
                {exportingDocx ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : blocked ? (
                  <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Export .docx
                {blocked && (
                  <span
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                    style={{ background: '#EF4444', color: '#fff' }}
                  >
                    {blockers.length}
                  </span>
                )}
              </Button>
            )
          })()}
```

**Step 4: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: gate DOCX export on HITL review completion"
```

---

## Task 6: Frontend — Review status in section sidebar

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx` (sidebar section list)

**Step 1: Find the sidebar section list** (around line 750–800 where section nav buttons are rendered)

Add a compact confidence dot next to each section name in the sidebar. Find the section nav button and add after the section label:

```typescript
{/* Confidence dot in sidebar */}
{(() => {
  const sec = sections[key] as TextSection | undefined
  const conf = sec?.confidence as ConfidenceLevel | undefined
  if (!conf || !sec?.ai_generated) return null
  const isDone = sec.user_edited || sec.reviewed || sec.low_verified
  if (isDone) return (
    <CheckCircle className="h-3 w-3 ml-auto shrink-0" style={{ color: '#22C55E' }} />
  )
  const dot = conf === 'low' ? '#EF4444' : conf === 'medium' ? '#F59E0B' : '#22C55E'
  return <span className="h-2 w-2 rounded-full ml-auto shrink-0" style={{ background: dot }} />
})()}
```

**Step 2: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: show confidence dots in CAM section sidebar"
```

---

## Task 7: Smoke test end-to-end

**Step 1: Start Python service**
```bash
cd /Users/gaurav/creditguardai/python-service
source venv/bin/activate
uvicorn main:app --port 8001 --reload
```

**Step 2: Start Next.js**
```bash
cd /Users/gaurav/creditguardai
npm run dev
```

**Step 3: Manual test checklist**
- [ ] Open an existing borrower → click a CAM upload → open CAM Note
- [ ] Click "Generate AI Draft" — confirm sections load with confidence badges
- [ ] `recommendation` section shows red "Low — Edit or Verify" badge
- [ ] `company_background` shows green "High Confidence" badge
- [ ] Click "Export .docx" without reviewing anything → blocked with red badge count
- [ ] On `recommendation`: click "Verify Anyway" → badge turns green
- [ ] On a medium section: click "Mark as Reviewed" → badge turns green
- [ ] With all Low sections cleared: Export button turns normal, DOCX downloads
- [ ] Edit a section's text → `user_edited` = true → section counts as reviewed automatically

**Step 4: Final commit**
```bash
git add -A
git commit -m "feat: complete HITL + confidence scoring system (PRD MVP)"
```
