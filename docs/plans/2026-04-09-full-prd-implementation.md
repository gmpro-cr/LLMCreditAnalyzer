# Full PRD Implementation Plan — CreditGuard AI

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement every remaining MVP feature from the PRD that is not yet in the codebase — covering the 12 CAM sections, confidence/HITL, risk flag engine, new sections, PDF export, Excel upload, version history, and section locking.

**Architecture:** Python FastAPI service handles all AI/data work (cam_sections.py, risk_flags.py, extractor.py). Next.js API routes proxy to Python and persist to SQLite via lib/db.ts. React frontend (CamNoteEditor.tsx) is the main UI surface for all HITL interactions.

**Tech Stack:** Python 3 / FastAPI, Next.js 16 / React 19, SQLite (better-sqlite3), Tailwind CSS, openpyxl (Excel), weasyprint or reportlab (PDF)

---

## Gap Summary

| Gap | Tasks |
|---|---|
| Confidence scoring + HITL review gate | Tasks 1–6 |
| Risk Flag Engine + Risk Summary section | Tasks 7–8 |
| Executive Summary section (AI, generated last) | Task 9 |
| Financial Analysis Narrative (AI section) | Task 9 |
| Working Capital AI draft (currently manual-only) | Task 9 |
| Proposed Facility Structure section (RM form) | Task 10 |
| Section lock/unlock after review | Task 11 |
| Excel / CMA file upload | Task 12 |
| PDF export | Task 13 |
| Version history (save snapshots, view list) | Task 14 |

---

## Task 1: Python — Add confidence scoring to `cam_sections.py`

**Files:**
- Modify: `python-service/cam_sections.py`

**Step 1: Add confidence rules dict and helper above `generate_cam_sections` (after line ~291)**

```python
# ── Confidence rules ──────────────────────────────────────────────────────────

SECTION_CONFIDENCE: Dict[str, tuple] = {
    "company_background":  ("high",   "Extracted directly from structured company data"),
    "group_structure":     ("medium", "Inferred from available data; verify with MCA records"),
    "management_profile":  ("medium", "Based on available promoter data; KYC verification required"),
    "business_model":      ("medium", "Inferred from financials and research; verify key claims"),
    "industry_analysis":   ("medium", "Drawn from sector knowledge base and web research"),
    "financial_analysis":  ("high",   "Derived from computed financial ratios and extracted data"),
    "working_capital":     ("medium", "Inferred from balance sheet; verify against stock statement"),
    "key_issues":          ("medium", "Synthesised from ratios and research; RM judgement required"),
    "recommendation":      ("low",    "AI scaffold only — recommendation MUST be authored by RM"),
    "executive_summary":   ("medium", "Synthesised from all other sections; review each source section"),
}


def _resolve_confidence(section_key: str, financials: Dict) -> tuple:
    confidence, reason = SECTION_CONFIDENCE.get(section_key, ("medium", "AI-generated content"))
    if section_key == "company_background":
        ci = financials.get("company_info", {})
        if not ci.get("name") and not ci.get("description"):
            return ("medium", "Company info sparse — verify background details")
    return (confidence, reason)
```

**Step 2: Update the batch generation loop (line ~334) to attach confidence fields**

Replace:
```python
        sections[key] = {
            "content": content,
            "user_edited": False,
            "ai_generated": True,
        }
```
With:
```python
        conf, reason = _resolve_confidence(key, financials)
        sections[key] = {
            "content":           content,
            "user_edited":       False,
            "ai_generated":      True,
            "confidence":        conf,
            "confidence_reason": reason,
            "reviewed":          False,
            "low_verified":      False,
            "locked":            False,
        }
```

**Step 3: Update single-section regeneration path (line ~318)**

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
                "locked":            False,
            }
        }
```

**Step 4: Quick verify**
```bash
cd /Users/gaurav/creditguardai/python-service
python -c "
from cam_sections import generate_cam_sections
s = generate_cam_sections({'company_info': {'name': 'Test Co'}}, {}, 'Test Co')
for k, v in s.items():
    if isinstance(v, dict) and 'confidence' in v:
        print(k, '->', v['confidence'])
"
```
Expected: each AI section printed with confidence level.

**Step 5: Commit**
```bash
cd /Users/gaurav/creditguardai
git add python-service/cam_sections.py
git commit -m "feat: add confidence scoring fields to CAM section generation"
```

---

## Task 2: Python — Add new AI sections (Executive Summary, Financial Analysis, Working Capital)

**Files:**
- Modify: `python-service/cam_sections.py`

**Step 1: Add new sections to `AI_SECTIONS` list (line ~32)**

Current:
```python
AI_SECTIONS = [
    "company_background",
    "group_structure",
    "management_profile",
    "business_model",
    "industry_analysis",
    "key_issues",
    "recommendation",
]
```

Replace with:
```python
AI_SECTIONS = [
    "company_background",
    "group_structure",
    "management_profile",
    "business_model",
    "industry_analysis",
    "financial_analysis",
    "working_capital",
    "key_issues",
    "recommendation",
    "executive_summary",   # generated last — synthesises all others
]
```

**Step 2: Add new prompts to `SECTION_PROMPTS` dict**

After the existing `recommendation` entry, add:

```python
    "financial_analysis": (
        "Write a financial analysis narrative covering: revenue and PAT trend over 3–5 years, "
        "EBITDA margin trajectory, debt levels and leverage trend, interest coverage and DSCR adequacy, "
        "working capital efficiency (debtor/inventory/creditor days), and overall credit quality assessment. "
        "Reference specific figures from the data. Flag any deteriorating trends or anomalies explicitly."
    ),
    "working_capital": (
        "Analyse the working capital position: describe the operating cycle length, "
        "key components (inventory days, debtor days, creditor days), adequacy of working capital limits, "
        "drawing power assessment based on current assets, and any concerns around WC utilisation patterns. "
        "Use only data available; flag areas requiring stock statement verification."
    ),
    "executive_summary": (
        "Write a concise executive summary (maximum 1 page) covering: borrower name and proposed facility, "
        "business overview in 2–3 sentences, key financial highlights (revenue, PAT, DSCR, leverage), "
        "credit strengths, top 2–3 risk factors, and the recommended credit decision. "
        "This is the first section a credit committee member will read — make it crisp and decisive."
    ),
```

**Step 3: In `generate_cam_sections`, move executive_summary generation after all others**

At end of the batch generation loop, add special handling so executive_summary uses the other completed sections as context:

```python
    # Generate executive_summary last with enriched context (uses all other section summaries)
    if "executive_summary" in AI_SECTIONS:
        summary_snippets = []
        for key in ["company_background", "business_model", "financial_analysis",
                    "key_issues", "recommendation"]:
            sec = sections.get(key, {})
            content = sec.get("content", "")
            if content:
                summary_snippets.append(f"[{key.upper()}]\n{content[:600]}")
        exec_context = context_text + "\n\n--- SECTION SUMMARIES ---\n" + "\n\n".join(summary_snippets)
        exec_content = _draft_section("executive_summary", exec_context, company_name)
        conf, reason = _resolve_confidence("executive_summary", financials)
        sections["executive_summary"] = {
            "content":           exec_content,
            "user_edited":       False,
            "ai_generated":      True,
            "confidence":        conf,
            "confidence_reason": reason,
            "reviewed":          False,
            "low_verified":      False,
            "locked":            False,
        }
```

Note: remove "executive_summary" from the main batch loop so it doesn't get generated twice. In `_draft_all_sections_batch`, pass only the non-executive sections:

```python
    batch_sections = [k for k in AI_SECTIONS if k != "executive_summary"]
    batch = _draft_all_sections_batch(context_text, company_name, batch_sections)
```

Update `_draft_all_sections_batch` signature to accept optional `sections` list:
```python
def _draft_all_sections_batch(
    context_text: str,
    company_name: str,
    sections: list = None,
) -> Dict[str, str]:
    target = sections or AI_SECTIONS
    section_list = "\n".join(
        f"{_DELIM}{k}###\n{SECTION_PROMPTS[k]}"
        for k in target if k in SECTION_PROMPTS
    )
    ...
```

**Step 4: Also change `working_capital` scaffold in the manual sections block** (line ~358) — remove it since it's now an AI section:

```python
    # Remove this block (working_capital is now AI-generated):
    # sections["working_capital"] = {
    #     "content": "",
    #     "user_edited": False,
    #     "ai_generated": False,
    # }
```

**Step 5: Commit**
```bash
git add python-service/cam_sections.py
git commit -m "feat: add executive_summary, financial_analysis, working_capital AI sections"
```

---

## Task 3: Python — Risk Flag Engine

**Files:**
- Create: `python-service/risk_flags.py`
- Modify: `python-service/main.py`

**Step 1: Create `python-service/risk_flags.py`**

```python
"""
Risk Flag Engine — automatically identifies credit risk signals from financial ratios.
Returns a list of risk flags with severity (high/medium/low) and evidence.
"""
from typing import Dict, List, Any


RATIO_RISK_RULES = [
    # (ratio_key, operator, threshold, severity, title, description_template)
    ("current_ratio",       "lt", 1.0,  "high",   "Low Liquidity",
     "Current ratio of {val:.2f}x is below 1.0x, indicating insufficient current assets to cover short-term liabilities."),
    ("current_ratio",       "lt", 1.33, "medium", "Tight Liquidity",
     "Current ratio of {val:.2f}x is below the standard banking threshold of 1.33x."),
    ("debt_equity",         "gt", 3.0,  "high",   "High Leverage",
     "Debt/Equity ratio of {val:.2f}x is significantly elevated, indicating over-reliance on debt financing."),
    ("debt_equity",         "gt", 2.0,  "medium", "Elevated Leverage",
     "Debt/Equity ratio of {val:.2f}x is above the comfortable 2.0x threshold."),
    ("tol_tnw",             "gt", 4.0,  "high",   "High TOL/TNW",
     "TOL/TNW of {val:.2f}x is elevated, suggesting high total outside liabilities relative to net worth."),
    ("interest_coverage",   "lt", 1.5,  "high",   "Weak Interest Coverage",
     "Interest coverage of {val:.2f}x is critically low — EBIT barely covers interest obligations."),
    ("interest_coverage",   "lt", 2.5,  "medium", "Thin Interest Coverage",
     "Interest coverage of {val:.2f}x is below the comfortable 2.5x benchmark."),
    ("dscr",                "lt", 1.0,  "high",   "DSCR Below 1.0x",
     "DSCR of {val:.2f}x is below 1.0x — the borrower cannot service debt from operating cash flows."),
    ("dscr",                "lt", 1.25, "medium", "Tight DSCR",
     "DSCR of {val:.2f}x is below the standard 1.25x benchmark, leaving limited debt-service headroom."),
    ("ebitda_margin",       "lt", 5.0,  "high",   "Very Low EBITDA Margin",
     "EBITDA margin of {val:.1f}% is critically low, limiting debt-servicing capacity."),
    ("ebitda_margin",       "lt", 10.0, "medium", "Low EBITDA Margin",
     "EBITDA margin of {val:.1f}% is below 10%, typical for stressed sectors."),
    ("net_margin",          "lt", 0.0,  "high",   "Net Loss",
     "The company is reporting a net loss (net margin {val:.1f}%), indicating fundamental profitability concerns."),
    ("debtor_days",         "gt", 120,  "high",   "High Debtor Days",
     "Debtor collection period of {val:.0f} days is very high, indicating receivables stress or liberal credit terms."),
    ("debtor_days",         "gt", 90,   "medium", "Elevated Debtor Days",
     "Debtor days of {val:.0f} days is above 90, warranting review of receivables quality."),
    ("inventory_days",      "gt", 180,  "high",   "High Inventory Days",
     "Inventory holding of {val:.0f} days is very high — risk of obsolescence or demand slowdown."),
    ("inventory_days",      "gt", 90,   "medium", "Elevated Inventory Days",
     "Inventory days of {val:.0f} days is above the sector comfort threshold."),
    ("operating_cycle",     "gt", 180,  "medium", "Long Operating Cycle",
     "Operating cycle of {val:.0f} days is extended, increasing working capital funding requirement."),
]


def _check(val: float, operator: str, threshold: float) -> bool:
    if operator == "lt":  return val < threshold
    if operator == "gt":  return val > threshold
    if operator == "lte": return val <= threshold
    if operator == "gte": return val >= threshold
    return False


def generate_risk_flags(ratios: Dict[str, float], financials: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Analyse financial ratios and return a list of risk flags.
    Each flag: {severity, title, description, ratio_key, value}
    """
    flags: List[Dict[str, Any]] = []
    seen_titles: set = set()

    for (ratio_key, operator, threshold, severity, title, desc_template) in RATIO_RISK_RULES:
        val = ratios.get(ratio_key)
        if val is None:
            continue
        if _check(val, operator, threshold):
            # Avoid duplicate titles (e.g. both high and medium leverage rules firing)
            if title in seen_titles:
                continue
            seen_titles.add(title)
            flags.append({
                "severity":    severity,
                "title":       title,
                "description": desc_template.format(val=val),
                "ratio_key":   ratio_key,
                "value":       round(val, 3),
            })

    # Check YoY revenue decline (multi-year data)
    pl = financials.get("profit_loss", {})
    revenue = pl.get("revenue", [])
    if isinstance(revenue, list) and len(revenue) >= 2:
        latest  = revenue[-1]
        prev    = revenue[-2]
        if prev and prev > 0 and latest is not None:
            growth = (latest - prev) / prev * 100
            if growth < -10:
                flags.append({
                    "severity":    "high",
                    "title":       "Revenue Decline",
                    "description": f"Revenue declined {abs(growth):.1f}% YoY — significant demand or market share concern.",
                    "ratio_key":   "revenue_growth",
                    "value":       round(growth, 1),
                })
            elif growth < 0:
                flags.append({
                    "severity":    "medium",
                    "title":       "Revenue Contraction",
                    "description": f"Revenue contracted {abs(growth):.1f}% YoY.",
                    "ratio_key":   "revenue_growth",
                    "value":       round(growth, 1),
                })

    # Sort: high first, then medium, then low
    order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda f: order.get(f["severity"], 3))
    return flags
```

**Step 2: Add endpoint to `python-service/main.py`** (after the `/evaluate-covenants` endpoint)

First add the import at the top:
```python
from risk_flags import generate_risk_flags
```

Then add the endpoint:
```python
@app.post("/risk-flags")
async def get_risk_flags(data: dict):
    """
    Generate risk flags from financial ratios.
    Input: {ratios: {...}, financials: {...}}
    Output: {flags: [...], high_count, medium_count, low_count}
    """
    ratios     = data.get("ratios", {})
    financials = data.get("financials", {})
    if not ratios:
        raise HTTPException(400, "ratios is required")
    flags = generate_risk_flags(ratios, financials)
    return {
        "flags":        flags,
        "high_count":   sum(1 for f in flags if f["severity"] == "high"),
        "medium_count": sum(1 for f in flags if f["severity"] == "medium"),
        "low_count":    sum(1 for f in flags if f["severity"] == "low"),
    }
```

**Step 3: Quick verify**
```bash
cd /Users/gaurav/creditguardai/python-service
python -c "
from risk_flags import generate_risk_flags
flags = generate_risk_flags({'current_ratio': 0.8, 'debt_equity': 3.5, 'dscr': 0.9}, {})
for f in flags: print(f['severity'].upper(), '-', f['title'])
"
```
Expected: HIGH Low Liquidity, HIGH High Leverage, HIGH DSCR Below 1.0x

**Step 4: Commit**
```bash
git add python-service/risk_flags.py python-service/main.py
git commit -m "feat: add risk flag engine with severity classification"
```

---

## Task 4: Next.js API — Risk flags route

**Files:**
- Create: `app/api/borrowers/[id]/risk-flags/route.ts`

**Step 1: Create the route**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  // Get the latest completed upload for this borrower
  const { data: uploads } = await supabase
    .from('financial_uploads')
    .select('extracted_data, ratios')
    .eq('borrower_id', id)
    .eq('status', 'complete')
    .order('upload_date', { ascending: false })

  if (!uploads || uploads.length === 0) {
    return NextResponse.json({ flags: [], high_count: 0, medium_count: 0, low_count: 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latest = uploads[0] as any
  const ratios     = latest.ratios     ?? {}
  const financials = latest.extracted_data ?? {}

  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'
  try {
    const pyRes = await fetch(`${pythonUrl}/risk-flags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratios, financials }),
    })
    if (!pyRes.ok) return NextResponse.json({ flags: [] })
    return NextResponse.json(await pyRes.json())
  } catch {
    return NextResponse.json({ flags: [] })
  }
}
```

**Step 2: Commit**
```bash
git add app/api/borrowers/\[id\]/risk-flags/route.ts
git commit -m "feat: add risk flags API route"
```

---

## Task 5: Frontend — TypeScript types update in `CamNoteEditor.tsx`

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add `ConfidenceLevel` type and update `TextSection` interface** (replace lines 8–18):

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
  locked?: boolean
}
```

**Step 2: Update `AI_SECTION_KEYS` array** (line ~66) to include new sections:

```typescript
const AI_SECTION_KEYS = [
  'executive_summary',
  'company_background',
  'group_structure',
  'management_profile',
  'business_model',
  'industry_analysis',
  'financial_analysis',
  'working_capital',
  'key_issues',
  'recommendation',
]
```

**Step 3: Update `SECTION_META`** to add new sections and remove `working_capital` manual flag:

```typescript
const SECTION_META: Record<string, { label: string; icon: string; manual?: boolean; description: string }> = {
  executive_summary:   { label: 'Executive Summary',    icon: '📋', description: '1-page synthesis for credit committee' },
  company_background:  { label: 'Company Background',   icon: '🏢', description: 'Incorporation, business segments, milestones' },
  group_structure:     { label: 'Group Structure',      icon: '🔗', description: 'Parent, subsidiaries, cross-holdings' },
  management_profile:  { label: 'Management Profile',   icon: '👤', description: 'Promoters, directors, PEP check' },
  business_model:      { label: 'Business Model',       icon: '⚙️', description: 'Revenue streams, customers, positioning' },
  industry_analysis:   { label: 'Industry Analysis',    icon: '📊', description: 'Sector trends, competitive dynamics' },
  financial_analysis:  { label: 'Financial Analysis',   icon: '📈', description: 'AI narrative on ratio trends & anomalies' },
  financial_tables:    { label: 'Financial Tables',     icon: '📋', description: '3-year P&L, B/S, ratios — auto computed', manual: true },
  peer_comparison:     { label: 'Peer Comparison',      icon: '⚖️', description: 'Peer financial metrics table', manual: true },
  banking_arrangement: { label: 'Banking Arrangement',  icon: '🏦', description: 'Sole / Multiple / Consortium banks', manual: true },
  proposed_structure:  { label: 'Proposed Structure',   icon: '🏗️', description: 'Facility type, amount, tenor, security', manual: true },
  working_capital:     { label: 'Working Capital',      icon: '💧', description: 'WC cycle, utilisation, drawing power' },
  account_conduct:     { label: 'Account Conduct',      icon: '📝', description: 'Account history, NPA indicators', manual: true },
  risk_summary:        { label: 'Risk Summary',         icon: '⚠️', description: 'Auto-detected risk flags with severity', manual: true },
  key_issues:          { label: 'Key Issues',            icon: '🚨', description: 'Credit concerns and risk flags' },
  recommendation:      { label: 'Recommendation',       icon: '✅', description: 'Final credit decision and conditions' },
}

const SECTION_ORDER = Object.keys(SECTION_META)
```

**Step 4: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: update CamNoteEditor types and section definitions for new PRD sections"
```

---

## Task 6: Frontend — `ConfidenceBadge` + HITL review workflow

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add `ConfidenceBadge` component** after the `fmt` helper (~line 95):

```typescript
// ── Confidence Badge ────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<ConfidenceLevel, {
  bg: string; border: string; dot: string; text: string; label: string
}> = {
  high:   { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E', text: '#15803D', label: 'High Confidence' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B', text: '#92400E', label: 'Medium — Review Required' },
  low:    { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444', text: '#991B1B', label: 'Low — Edit or Verify' },
}

function ConfidenceBadge({ level, reason }: { level: ConfidenceLevel; reason?: string }) {
  const s = CONFIDENCE_STYLES[level]
  return (
    <div
      title={reason}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full cursor-default"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      <span className="text-[10px] font-semibold tracking-wide" style={{ color: s.text }}>{s.label}</span>
    </div>
  )
}
```

**Step 2: Update `TextSectionEditor` props** to add review callbacks (replace signature ~line 406):

```typescript
function TextSectionEditor({
  sectionKey, section, onChange, onRegenerate, isRegenerating, onMarkReviewed, onVerifyLow,
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

**Step 3: Add HITL review row inside `TextSectionEditor`**, just before the closing `</div>` (after the `onRegenerate` block):

```typescript
      {/* Confidence + HITL review row */}
      {section.ai_generated && section.confidence && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{
            background: section.confidence === 'low' ? '#FEF2F2'
              : section.confidence === 'medium' ? '#FFFBEB' : '#F0FDF4',
            border: `1px solid ${section.confidence === 'low' ? '#FECACA'
              : section.confidence === 'medium' ? '#FDE68A' : '#BBF7D0'}`,
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ConfidenceBadge level={section.confidence as ConfidenceLevel} reason={section.confidence_reason} />
            {section.confidence_reason && (
              <span className="text-[11px] text-muted-foreground truncate hidden sm:block">
                {section.confidence_reason}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {section.confidence === 'medium' && !section.reviewed && !section.user_edited && (
              <button
                onClick={onMarkReviewed}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
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
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
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

**Step 4: Wire callbacks in the main render loop** (around line 863 where AI sections are rendered):

```typescript
                  {AI_SECTION_KEYS.includes(activeSection) && (
                    <TextSectionEditor
                      sectionKey={activeSection}
                      section={sections[activeSection] as TextSection ?? { content: '', user_edited: false, ai_generated: false }}
                      onChange={data => updateSection(activeSection, data)}
                      onRegenerate={() => handleRegenerateSection(activeSection)}
                      isRegenerating={regeneratingSections.has(activeSection)}
                      onMarkReviewed={() => updateSection(activeSection, { ...(sections[activeSection] as TextSection), reviewed: true })}
                      onVerifyLow={() => updateSection(activeSection, { ...(sections[activeSection] as TextSection), low_verified: true })}
                    />
                  )}
```

**Step 5: Also render `working_capital` using AI section path** — remove the existing manual block for `working_capital` in the conditional (line ~855) and let it fall through to the AI_SECTION_KEYS block.

**Step 6: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add ConfidenceBadge and HITL review workflow to CAM editor"
```

---

## Task 7: Frontend — Export gate + confidence dots in sidebar

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add `computeExportReadiness` helper** after `buildDocxContent`:

```typescript
function computeExportReadiness(sections: CamSections): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = []
  const warnings: string[] = []
  for (const key of AI_SECTION_KEYS) {
    const sec = sections[key] as TextSection | undefined
    if (!sec?.ai_generated) continue
    const conf = sec.confidence as ConfidenceLevel | undefined
    if (conf === 'low' && !sec.user_edited && !sec.low_verified) {
      blockers.push(`"${SECTION_META[key]?.label ?? key}" is Low confidence — edit or verify`)
    } else if (conf === 'medium' && !sec.reviewed && !sec.user_edited) {
      warnings.push(`"${SECTION_META[key]?.label ?? key}" not yet reviewed`)
    }
  }
  return { blockers, warnings }
}
```

**Step 2: Update `handleExportDocx`** to check blockers before exporting:

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
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/\s+/g, '_')}_FY${financialYear}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingDocx(false)
    }
  }
```

**Step 3: Replace the Export button** in the top bar (around line 705) to show a blocker count badge:

```typescript
          {(() => {
            const { blockers } = computeExportReadiness(sections)
            const blocked = blockers.length > 0
            return (
              <Button
                variant="outline" size="sm"
                onClick={handleExportDocx}
                disabled={exportingDocx}
                className="text-xs font-medium relative"
                style={blocked ? { borderColor: '#EF4444', color: '#991B1B' } : undefined}
                title={blocked ? `${blockers.length} issue(s) blocking export` : 'Export to Word'}
              >
                {exportingDocx ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : blocked ? <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                  : <Download className="h-3.5 w-3.5 mr-1.5" />}
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

**Step 4: Add confidence dot to sidebar** — inside the sidebar section button (around line 797), add after the AI/Edited label:

```typescript
                    {/* Confidence dot */}
                    {(() => {
                      const s = sections[key] as TextSection | undefined
                      const conf = s?.confidence as ConfidenceLevel | undefined
                      if (!conf || !s?.ai_generated) return null
                      const cleared = s.user_edited || s.reviewed || s.low_verified
                      if (cleared) return <CheckCircle className="h-2.5 w-2.5 ml-1" style={{ color: '#22C55E' }} />
                      const dot = conf === 'low' ? '#EF4444' : conf === 'medium' ? '#F59E0B' : '#22C55E'
                      return <span className="h-1.5 w-1.5 rounded-full ml-1 shrink-0" style={{ background: dot }} />
                    })()}
```

**Step 5: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add export gate and confidence dots in CAM section sidebar"
```

---

## Task 8: Frontend — Risk Summary section + Proposed Facility Structure section

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/page.tsx`

**Step 1: Add `RiskSummarySection` component** in `CamNoteEditor.tsx`, after `PeerComparisonSection`:

```typescript
// ── Risk Summary ────────────────────────────────────────────────────────────

interface RiskFlag {
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
}

const SEVERITY_STYLES = {
  high:   { bg: '#FEF2F2', border: '#FECACA', dot: '#EF4444', text: '#991B1B', badge: '#FEE2E2', badgeText: '#B91C1C' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', dot: '#F59E0B', text: '#92400E', badge: '#FEF3C7', badgeText: '#B45309' },
  low:    { bg: '#F0FDF4', border: '#BBF7D0', dot: '#22C55E', text: '#15803D', badge: '#DCFCE7', badgeText: '#15803D' },
}

function RiskSummarySection({ riskFlags }: { riskFlags: RiskFlag[] }) {
  if (riskFlags.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No risk flags detected. Run financial analysis to generate risk summary.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs font-medium mb-4">
        {(['high', 'medium', 'low'] as const).map(sev => {
          const count = riskFlags.filter(f => f.severity === sev).length
          if (!count) return null
          const s = SEVERITY_STYLES[sev]
          return (
            <div key={sev} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
              style={{ background: s.badge, color: s.badgeText }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
              {count} {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </div>
          )
        })}
      </div>
      {riskFlags.map((flag, i) => {
        const s = SEVERITY_STYLES[flag.severity]
        return (
          <div key={i} className="rounded-xl p-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.dot }} />
              <span className="text-sm font-semibold" style={{ color: s.text }}>{flag.title}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ml-auto"
                style={{ background: s.badge, color: s.badgeText }}>
                {flag.severity}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-4">{flag.description}</p>
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Add `ProposedStructureSection` component** (structured RM form):

```typescript
// ── Proposed Facility Structure ────────────────────────────────────────────

interface ProposedStructure {
  facility_type: string
  amount_cr: string
  tenor_months: string
  pricing_rate: string
  security_primary: string
  security_collateral: string
  covenants: string
  conditions_precedent: string
  user_edited: boolean
  ai_generated: false
}

function ProposedStructureSection({
  section,
  onChange,
}: {
  section: ProposedStructure
  onChange: (updated: ProposedStructure) => void
}) {
  const update = (field: keyof ProposedStructure, value: string) =>
    onChange({ ...section, [field]: value, user_edited: true })

  const FACILITY_TYPES = ['Term Loan', 'Cash Credit', 'OD', 'WCDL', 'LC', 'BG', 'ECB', 'NCD', 'Buyer\'s Credit']

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Facility Type</label>
          <select
            value={section.facility_type}
            onChange={e => update('facility_type', e.target.value)}
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          >
            <option value="">Select…</option>
            {FACILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Amount (₹ Cr)</label>
          <input
            value={section.amount_cr}
            onChange={e => update('amount_cr', e.target.value)}
            placeholder="e.g. 25.00"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Tenor (months)</label>
          <input
            value={section.tenor_months}
            onChange={e => update('tenor_months', e.target.value)}
            placeholder="e.g. 84"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Pricing / Rate</label>
          <input
            value={section.pricing_rate}
            onChange={e => update('pricing_rate', e.target.value)}
            placeholder="e.g. MCLR + 1.25%"
            className="w-full text-sm p-2.5 rounded-xl border border-border bg-background outline-none focus:border-foreground/30"
          />
        </div>
      </div>
      {[
        { field: 'security_primary' as const,    label: 'Primary Security',       rows: 2, placeholder: 'e.g. First charge on fixed assets...' },
        { field: 'security_collateral' as const, label: 'Collateral Security',     rows: 2, placeholder: 'e.g. Mortgage of property...' },
        { field: 'covenants' as const,           label: 'Financial Covenants',     rows: 3, placeholder: 'e.g. Maintain DSCR ≥ 1.25x; D/E ≤ 2.5x...' },
        { field: 'conditions_precedent' as const,label: 'Conditions Precedent',    rows: 3, placeholder: 'e.g. Submission of audited financials...' },
      ].map(({ field, label, rows, placeholder }) => (
        <div key={field}>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
          <textarea
            value={section[field]}
            onChange={e => update(field, e.target.value)}
            rows={rows}
            placeholder={placeholder}
            className="w-full text-sm p-3 rounded-xl border border-border bg-background outline-none focus:border-foreground/30 resize-none"
          />
        </div>
      ))}
    </div>
  )
}
```

**Step 3: Update `CamSections` interface** to add new section types:

```typescript
interface CamSections {
  executive_summary?:  TextSection
  company_background?: TextSection
  group_structure?:    TextSection
  management_profile?: TextSection
  business_model?:     TextSection
  industry_analysis?:  TextSection
  financial_analysis?: TextSection
  working_capital?:    TextSection
  banking_arrangement?: BankingSection
  proposed_structure?: ProposedStructure
  account_conduct?:    TextSection
  key_issues?:         TextSection
  recommendation?:     TextSection
  [key: string]: CamSection | undefined
}
```

**Step 4: Update `Props`** to accept riskFlags:

```typescript
interface Props {
  borrowerId: string
  uploadId: string
  companyName: string
  industry: string
  financialYear: string
  extractedData: Record<string, any>
  ratios: Record<string, any>
  camSections: CamSections | null
  memoContent: string
  riskFlags?: RiskFlag[]
}
```

**Step 5: Scaffold `proposed_structure` in Python** (in `generate_cam_sections`, after the `banking_arrangement` scaffold):

In `python-service/cam_sections.py`, add:
```python
    sections["proposed_structure"] = {
        "facility_type":      "",
        "amount_cr":          "",
        "tenor_months":       "",
        "pricing_rate":       "",
        "security_primary":   "",
        "security_collateral": "",
        "covenants":          "",
        "conditions_precedent": "",
        "user_edited":        False,
        "ai_generated":       False,
    }
```

**Step 6: Render new sections in the main editor pane** — add cases alongside existing section renders (around line 838):

```typescript
                  {activeSection === 'risk_summary' && (
                    <RiskSummarySection riskFlags={riskFlags ?? []} />
                  )}

                  {activeSection === 'proposed_structure' && (
                    <ProposedStructureSection
                      section={sections.proposed_structure ?? {
                        facility_type: '', amount_cr: '', tenor_months: '',
                        pricing_rate: '', security_primary: '', security_collateral: '',
                        covenants: '', conditions_precedent: '',
                        user_edited: false, ai_generated: false,
                      }}
                      onChange={data => updateSection('proposed_structure', data)}
                    />
                  )}
```

**Step 7: Update `buildDocxContent`** to include new sections:

Add proposed_structure serialisation in the `buildDocxContent` function, similar to banking_arrangement:
```typescript
      } else if (key === 'proposed_structure') {
        const ps = sec as ProposedStructure
        if (ps.facility_type) parts.push(`Facility Type: ${ps.facility_type}\n`)
        if (ps.amount_cr) parts.push(`Amount: ₹${ps.amount_cr} Cr\n`)
        if (ps.tenor_months) parts.push(`Tenor: ${ps.tenor_months} months\n`)
        if (ps.pricing_rate) parts.push(`Pricing: ${ps.pricing_rate}\n`)
        if (ps.security_primary) parts.push(`\nPrimary Security:\n${ps.security_primary}\n`)
        if (ps.security_collateral) parts.push(`\nCollateral:\n${ps.security_collateral}\n`)
        if (ps.covenants) parts.push(`\nFinancial Covenants:\n${ps.covenants}\n`)
        if (ps.conditions_precedent) parts.push(`\nConditions Precedent:\n${ps.conditions_precedent}\n`)
```

**Step 8: Pass riskFlags from `page.tsx`**

In `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/page.tsx`, add a fetch for risk flags and pass them to `CamNoteEditor`:
```typescript
  // Fetch risk flags
  const riskRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/borrowers/${id}/risk-flags`, { cache: 'no-store' })
  const riskData = riskRes.ok ? await riskRes.json() : { flags: [] }

  // Pass to CamNoteEditor:
  riskFlags={riskData.flags}
```

**Step 9: Commit**
```bash
git add python-service/cam_sections.py \
        app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx \
        app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/page.tsx
git commit -m "feat: add Risk Summary and Proposed Facility Structure sections to CAM editor"
```

---

## Task 9: Frontend — Section lock/unlock

**Files:**
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add lock icon import** — `Lock, Unlock` from lucide-react (add to existing import line ~6).

**Step 2: In `TextSectionEditor`**, make textarea disabled when locked, and add a lock/unlock button:

Add to props:
```typescript
  onToggleLock?: () => void
```

In the component, update the textarea:
```typescript
      <textarea
        value={section.content}
        onChange={e => !section.locked && onChange({ ...section, content: e.target.value, user_edited: true })}
        rows={10}
        disabled={section.locked}
        placeholder={section.ai_generated ? 'AI draft will appear here after generation…' : 'Enter notes here…'}
        className="w-full text-sm p-4 rounded-xl border border-border outline-none focus:border-foreground/30 resize-y text-foreground placeholder:text-muted-foreground/50 transition-colors leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: section.locked ? 'oklch(0.970 0.004 78)' : 'oklch(0.993 0.003 78)', minHeight: 160 }}
      />
```

Add lock toggle button in the section header area of the editor pane (inside the section header div, after the section title):

```typescript
                      {/* Lock toggle */}
                      {AI_SECTION_KEYS.includes(activeSection) && (
                        <button
                          onClick={() => {
                            const sec = sections[activeSection] as TextSection
                            if (sec) updateSection(activeSection, { ...sec, locked: !sec.locked })
                          }}
                          title={((sections[activeSection] as TextSection)?.locked) ? 'Unlock section' : 'Lock section'}
                          className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                        >
                          {(sections[activeSection] as TextSection)?.locked
                            ? <Lock className="h-3.5 w-3.5" />
                            : <Unlock className="h-3.5 w-3.5" />}
                        </button>
                      )}
```

**Step 3: Auto-lock on Mark as Reviewed** — update the `onMarkReviewed` handler to also lock:

```typescript
onMarkReviewed={() => updateSection(activeSection, {
  ...(sections[activeSection] as TextSection),
  reviewed: true,
  locked: true,
})}
```

**Step 4: Show locked indicator in sidebar** — add after the confidence dot in the sidebar button:

```typescript
                    {(sections[key] as TextSection)?.locked && (
                      <Lock className="h-2.5 w-2.5 ml-0.5 text-muted-foreground" />
                    )}
```

**Step 5: Commit**
```bash
git add app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx
git commit -m "feat: add section lock/unlock to CAM editor"
```

---

## Task 10: Excel / CMA file upload support

**Files:**
- Modify: `python-service/extractor.py` (add Excel handling)
- Modify: `python-service/main.py` (update /extract to accept .xlsx)
- Modify: `app/(dashboard)/borrowers/[id]/upload/page.tsx` (update file input)
- Modify: `app/api/borrowers/[id]/upload/route.ts` (update validation)

**Step 1: Check if openpyxl is installed**
```bash
cd /Users/gaurav/creditguardai/python-service
source venv/bin/activate
pip show openpyxl 2>/dev/null || pip install openpyxl
```

**Step 2: Add `extract_excel_cma` function to `extractor.py`** (add at end of file):

```python
def extract_excel_cma(file_path: str, company_name: str = "") -> dict:
    """
    Extract financial data from CMA Excel files.
    Looks for standard CMA Data sheets: Balance Sheet, Profit & Loss, Cash Flow.
    Returns same structure as extract_financials_multi_pass.
    """
    import openpyxl
    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheet_names = [s.lower() for s in wb.sheetnames]

    result = {
        "company_info": {"name": company_name, "source": "excel_cma"},
        "profit_loss":  {},
        "balance_sheet": {},
        "cash_flow":    {},
        "source":       "excel",
    }

    def _cell_val(ws, row, col):
        v = ws.cell(row=row, column=col).value
        if isinstance(v, (int, float)): return float(v)
        return None

    def _find_row(ws, keyword, max_rows=100):
        kw = keyword.lower()
        for r in range(1, max_rows):
            for c in range(1, 6):
                v = ws.cell(row=r, column=c).value
                if v and kw in str(v).lower():
                    return r
        return None

    # Try to extract from each sheet
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        sn = sheet_name.lower()

        if any(k in sn for k in ["p&l", "profit", "income"]):
            rev_row = _find_row(ws, "revenue from operations") or _find_row(ws, "net sales")
            pat_row = _find_row(ws, "profit after tax") or _find_row(ws, "net profit")
            if rev_row:
                result["profit_loss"]["revenue"] = {
                    "revenue_from_operations": {"current": _cell_val(ws, rev_row, 3)}
                }
            if pat_row:
                result["profit_loss"].setdefault("profit_metrics", {})["profit_after_tax"] = \
                    {"current": _cell_val(ws, pat_row, 3)}

        elif any(k in sn for k in ["balance", "b/s", "bs"]):
            ta_row  = _find_row(ws, "total assets")
            tl_row  = _find_row(ws, "total liabilities")
            eq_row  = _find_row(ws, "net worth") or _find_row(ws, "equity")
            dbt_row = _find_row(ws, "total borrowings") or _find_row(ws, "term loan")
            if ta_row:
                result["balance_sheet"]["assets"] = {"total_assets": {"current": _cell_val(ws, ta_row, 3)}}
            if eq_row:
                result["balance_sheet"]["equity"] = {"total_equity": _cell_val(ws, eq_row, 3)}
            if dbt_row:
                result["balance_sheet"]["liabilities"] = {
                    "borrowings": {"total_borrowings": {"current": _cell_val(ws, dbt_row, 3)}}
                }

    return result
```

**Step 3: Update `/extract` endpoint in `main.py`** to accept `.xlsx`:

```python
@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    company_name: str = Form(default=""),
):
    fname = (file.filename or "").lower()
    is_pdf   = fname.endswith(".pdf")
    is_excel = fname.endswith(".xlsx") or fname.endswith(".xls")

    if not is_pdf and not is_excel:
        raise HTTPException(400, "Only PDF and Excel (.xlsx) files are supported")

    content = await file.read()
    if len(content) < 100:
        raise HTTPException(400, "File too small — upload a valid financial document")

    suffix = ".pdf" if is_pdf else ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if is_excel:
            from extractor import extract_excel_cma
            financials = extract_excel_cma(tmp_path, company_name)
        else:
            financials = extract_financials_multi_pass(tmp_path, company_name)
        ratios = calculate_ratios(financials)
        return {"financials": financials, "ratios": ratios, "company_name": company_name}
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        raise HTTPException(500, f"Extraction failed: {str(e)}")
    finally:
        os.unlink(tmp_path)
```

**Step 4: Update frontend upload page** — change the file input `accept` attribute:

In `app/(dashboard)/borrowers/[id]/upload/page.tsx`, find the file input and update:
```typescript
// Find: accept="application/pdf"
// Replace with:
accept="application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

Also update the validation message and step labels to mention Excel.

**Step 5: Update upload API route** — remove the PDF-only check in `app/api/borrowers/[id]/upload/route.ts`. The Python service now handles validation.

**Step 6: Commit**
```bash
git add python-service/extractor.py python-service/main.py \
        app/(dashboard)/borrowers/\[id\]/upload/page.tsx \
        app/api/borrowers/\[id\]/upload/route.ts
git commit -m "feat: add Excel/CMA file upload support"
```

---

## Task 11: PDF Export

**Files:**
- Modify: `python-service/main.py` (add /export-pdf endpoint)
- Create: `app/api/python-proxy/export-pdf/route.ts`
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Install weasyprint in python-service**
```bash
cd /Users/gaurav/creditguardai/python-service
source venv/bin/activate
pip install weasyprint markdown 2>/dev/null || echo "Install manually if needed"
pip freeze | grep -E "weasyprint|markdown" >> requirements.txt
```

**Step 2: Add `/export-pdf` endpoint to `main.py`** (after `/export-docx`):

```python
@app.post("/export-pdf")
async def export_pdf_endpoint(data: dict):
    """Export memo text to PDF and return the file."""
    memo_content = data.get("memo_content", "")
    company_name = data.get("company_name", "Borrower")
    if not memo_content:
        raise HTTPException(400, "memo_content is required")

    try:
        import markdown as md_lib
        import weasyprint

        html_body = md_lib.markdown(memo_content, extensions=["tables", "fenced_code"])
        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; line-height: 1.6;
          margin: 2cm; color: #1a1a1a; }}
  h1 {{ font-size: 18pt; color: #0D1B2A; border-bottom: 2px solid #0D1B2A; padding-bottom: 8px; }}
  h2 {{ font-size: 13pt; color: #0D1B2A; margin-top: 24px; border-bottom: 1px solid #d1d5db;
        padding-bottom: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }}
  th {{ background: #f3f4f6; padding: 6px 10px; text-align: left; border: 1px solid #d1d5db; }}
  td {{ padding: 6px 10px; border: 1px solid #d1d5db; }}
  .footer {{ font-size: 8pt; color: #6b7280; margin-top: 24px; border-top: 1px solid #d1d5db;
             padding-top: 8px; }}
</style>
</head>
<body>
{html_body}
<div class="footer">AI-assisted draft · Reviewed and approved by RM · CreditGuard AI · CONFIDENTIAL</div>
</body>
</html>"""

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp_path = tmp.name

        weasyprint.HTML(string=html).write_pdf(tmp_path)
        safe_name = company_name.replace(" ", "_").replace("/", "-")
        return FileResponse(
            tmp_path,
            media_type="application/pdf",
            filename=f"CAM_{safe_name}.pdf",
        )
    except ImportError:
        raise HTTPException(500, "PDF export requires 'weasyprint' and 'markdown' packages")
    except Exception as e:
        logger.error(f"PDF export failed: {e}", exc_info=True)
        raise HTTPException(500, f"PDF export failed: {str(e)}")
```

**Step 3: Create Next.js proxy route** at `app/api/python-proxy/export-pdf/route.ts`:

```typescript
import { NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(req: Request) {
  const body = await req.json()
  const pythonUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8001'

  const pyRes = await fetch(`${pythonUrl}/export-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!pyRes.ok) {
    const err = await pyRes.json().catch(() => ({}))
    return NextResponse.json({ error: (err as { detail?: string }).detail || 'PDF export failed' }, { status: 500 })
  }

  const blob = await pyRes.blob()
  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="CAM_export.pdf"`,
    },
  })
}
```

**Step 4: Add "Export PDF" button to `CamNoteEditor.tsx`** — add state and handler:

Add state: `const [exportingPdf, setExportingPdf] = useState(false)`

Add handler (after `handleExportDocx`):
```typescript
  const handleExportPdf = async () => {
    const { blockers } = computeExportReadiness(sections)
    if (blockers.length > 0) {
      alert(`Cannot export — resolve these issues first:\n\n• ${blockers.join('\n• ')}`)
      return
    }
    setExportingPdf(true)
    try {
      const content = buildDocxContent()
      const res = await fetch('/api/python-proxy/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_content: content, company_name: companyName }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CAM_${companyName.replace(/\s+/g, '_')}_FY${financialYear}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingPdf(false)
    }
  }
```

Add PDF button next to the DOCX button in the top bar:
```typescript
          <Button
            variant="outline" size="sm"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="text-xs font-medium"
          >
            {exportingPdf
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Export PDF
          </Button>
```

**Step 5: Commit**
```bash
git add python-service/main.py \
        app/api/python-proxy/export-pdf/route.ts \
        app/(dashboard)/borrowers/\[id\]/cam-note/\[uploadId\]/CamNoteEditor.tsx
git commit -m "feat: add PDF export via weasyprint"
```

---

## Task 12: Version History

**Files:**
- Modify: `lib/db.ts` (add memo_versions table)
- Create: `app/api/borrowers/[id]/cam-note/[uploadId]/versions/route.ts`
- Modify: `app/(dashboard)/borrowers/[id]/cam-note/[uploadId]/CamNoteEditor.tsx`

**Step 1: Add `memo_versions` table to `lib/db.ts`**

In `initSchema`, add inside the `db.exec(...)` call:

```sql
CREATE TABLE IF NOT EXISTS memo_versions (
  id          TEXT PRIMARY KEY,
  upload_id   TEXT NOT NULL,
  borrower_id TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT 'Draft',
  snapshot    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

Also add `memo_versions` to `JSON_FIELDS`:
```typescript
const JSON_FIELDS: Record<string, string[]> = {
  financial_uploads: ['extracted_data', 'ratios'],
  borrowers: ['public_data'],
  memo_versions: ['snapshot'],
}
```

**Step 2: Create versions API route** at `app/api/borrowers/[id]/cam-note/[uploadId]/versions/route.ts`:

```typescript
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string; uploadId: string }> }

// GET — list all saved versions
export async function GET(_req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('memo_versions')
    .select('id, label, created_at')
    .eq('upload_id', uploadId)
    .eq('borrower_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data ?? [] })
}

// POST — save current sections as a named version
export async function POST(req: Request, { params }: Params) {
  const { id, uploadId } = await params
  const supabase = await createServerSupabaseClient()
  const body = await req.json()
  const label    = (body.label as string) || 'Draft'
  const snapshot = body.snapshot           // cam_sections object

  if (!snapshot) return NextResponse.json({ error: 'snapshot required' }, { status: 400 })

  const { error } = await supabase
    .from('memo_versions')
    .insert({ id: randomUUID(), upload_id: uploadId, borrower_id: id, label, snapshot })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// GET with versionId param — load a specific version snapshot
// Handled via /versions/[versionId]/route.ts — see below
```

**Step 3: Create version restore route** at `app/api/borrowers/[id]/cam-note/[uploadId]/versions/[versionId]/route.ts`:

```typescript
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

type Params = { params: Promise<{ id: string; uploadId: string; versionId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id, uploadId, versionId } = await params
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('memo_versions')
    .select('id, label, snapshot, created_at')
    .eq('id', versionId)
    .eq('upload_id', uploadId)
    .eq('borrower_id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  return NextResponse.json(data)
}
```

**Step 4: Add version history UI to `CamNoteEditor.tsx`**

Add state:
```typescript
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<{id: string; label: string; created_at: string}[]>([])
  const [savingVersion, setSavingVersion] = useState(false)
```

Add `handleSaveVersion` function:
```typescript
  const handleSaveVersion = async () => {
    const label = prompt('Version label (e.g. "Before Credit Committee"):', `Draft ${new Date().toLocaleDateString('en-IN')}`)
    if (!label) return
    setSavingVersion(true)
    try {
      await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, snapshot: sections }),
      })
    } finally {
      setSavingVersion(false)
    }
  }

  const loadVersions = async () => {
    const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions`)
    if (res.ok) {
      const { versions: v } = await res.json()
      setVersions(v)
    }
    setShowVersions(true)
  }

  const restoreVersion = async (versionId: string) => {
    if (!confirm('Restore this version? Current unsaved changes will be overwritten.')) return
    const res = await fetch(`/api/borrowers/${borrowerId}/cam-note/${uploadId}/versions/${versionId}`)
    if (res.ok) {
      const { snapshot } = await res.json()
      setSections(snapshot)
      setShowVersions(false)
    }
  }
```

Add "Save Version" and "History" buttons in the top bar (after export buttons):
```typescript
          <Button variant="outline" size="sm" onClick={handleSaveVersion} disabled={savingVersion} className="text-xs">
            {savingVersion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Version
          </Button>
          <Button variant="outline" size="sm" onClick={loadVersions} className="text-xs">
            <FileText className="h-3.5 w-3.5 mr-1" /> History
          </Button>
```

Add version history panel (collapsible, shown below top bar when `showVersions` is true):
```typescript
      {showVersions && (
        <div className="mx-6 mt-3 rounded-xl border border-border p-4 bg-background shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Version History</span>
            <button onClick={() => setShowVersions(false)} className="text-muted-foreground text-xs">Close</button>
          </div>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved versions yet. Click "Save Version" to create one.</p>
          ) : (
            <div className="space-y-2">
              {versions.map(v => (
                <div key={v.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: 'oklch(0.978 0.006 78)', border: '1px solid var(--border)' }}>
                  <div>
                    <p className="text-xs font-medium">{v.label}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleString('en-IN')}</p>
                  </div>
                  <button
                    onClick={() => restoreVersion(v.id)}
                    className="text-xs font-medium px-2.5 py-1 rounded-lg"
                    style={{ background: '#0D1B2A', color: '#fff' }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
```

**Step 5: Commit**
```bash
git add lib/db.ts \
        app/api/borrowers/\[id\]/cam-note/\[uploadId\]/versions/route.ts \
        app/api/borrowers/\[id\]/cam-note/\[uploadId\]/versions/\[versionId\]/route.ts \
        app/(dashboard)/borrowers/\[id\]/cam-note/\[uploadId\]/CamNoteEditor.tsx
git commit -m "feat: add version history — save, list, and restore CAM section snapshots"
```

---

## Task 13: Smoke Test — Full end-to-end

**Step 1: Start services**
```bash
# Terminal 1
cd /Users/gaurav/creditguardai/python-service
source venv/bin/activate
uvicorn main:app --port 8001 --reload

# Terminal 2
cd /Users/gaurav/creditguardai
npm run dev
```

**Step 2: Manual test checklist**
- [ ] Upload a PDF → extraction completes, ratios show
- [ ] Upload an Excel (.xlsx) file → extraction completes
- [ ] Open CAM Note → click "Generate AI Draft"
- [ ] All 12 sections appear in the sidebar (including Executive Summary, Financial Analysis, Working Capital)
- [ ] `recommendation` shows red Low confidence badge
- [ ] `company_background` shows green High confidence badge
- [ ] Medium sections: "Mark as Reviewed" button works, section locks after review
- [ ] Low section: "Verify Anyway" or edit clears the blocker
- [ ] Export .docx blocked (red badge) while Low items unresolved → clears after all resolved
- [ ] Export PDF generates a formatted PDF
- [ ] Risk Summary section shows auto-detected flags with severity
- [ ] Proposed Structure form accepts facility type, amount, security fields
- [ ] "Save Version" prompts for label, saves → "History" shows the version → Restore loads it
- [ ] Sidebar confidence dots update correctly as sections are reviewed/edited

**Step 3: Final cleanup commit**
```bash
git add -A
git commit -m "chore: final cleanup after full PRD implementation"
```
