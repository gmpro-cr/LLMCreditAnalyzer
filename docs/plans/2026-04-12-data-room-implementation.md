# Data Room Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Data Room" tab to the case detail page where RMs can auto-fetch annual reports from BSE/NSE, run AI research, upload documents, and have all collected data feed the Generate AI Draft button.

**Architecture:** New DB tables (`case_documents`, `case_extracted_data`) store files and structured data. New Express routes (`/api/cases/:id/data-room/*`) handle uploads and orchestration. Two new Python endpoints (`/fetch-annual-reports`, `/extract-organogram`) extend existing capabilities. The Generate endpoint is updated to pass all collected data to the AI. Frontend gets a "Data Room" tab on the case detail page with four panels: Financials, Research, Documents, Summary.

**Tech Stack:** React + Vite (frontend), Express.js (api-server), Python FastAPI (python-service), Supabase (DB + Storage), BSE API + Screener.in (public data), pnpm workspaces (monorepo)

---

## Context for all tasks

**Repo root:** `/Users/gaurav/creditguardai/frontend/` (pnpm workspace)

**Key paths:**
- Frontend pages: `artifacts/creditguard/src/pages/cases/[id]/index.tsx`
- API server routes: `artifacts/api-server/src/routes/`
- API server DB: `artifacts/api-server/src/lib/supabase-db.ts`
- API hooks (hand-maintained "generated"): `lib/api-client-react/src/generated/api.ts`
- Python service: `/Users/gaurav/creditguardai/python-service/`
- DB schema: `schema.sql` (run manually in Supabase SQL Editor)

**Running services:**
- Frontend: `pnpm --filter @workspace/creditguard dev` → port 5173
- API server: `node dist/index.mjs` → port 3001 (rebuild: `pnpm --filter @workspace/api-server build`)
- Python: `uvicorn main:app --reload --port 8001` in `python-service/`

**Pattern for Express routes:** Each route file exports a `Router`. The router is mounted in `src/routes/index.ts`. Routes use `supabase-db.ts` functions for DB access.

**Pattern for API hooks:** `lib/api-client-react/src/generated/api.ts` exports `useXxx` hooks built on `useMutation` / `useQuery` from `@tanstack/react-query`. New hooks follow the same pattern. `customFetch` from `../custom-fetch` handles all HTTP.

---

## Task 1: Database Schema — New Tables

**Files:**
- Modify: `schema.sql`

**Step 1: Add the new tables to schema.sql**

Append to the bottom of `/Users/gaurav/creditguardai/frontend/schema.sql`:

```sql
-- Data Room tables

CREATE TABLE IF NOT EXISTS case_documents (
  id             SERIAL PRIMARY KEY,
  case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL,
  filename       TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  fiscal_year    TEXT,
  extracted_text TEXT,
  extracted_data JSONB,
  source         TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_extracted_data (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE UNIQUE,
  financials  JSONB,
  research    JSONB,
  peers       JSONB,
  organogram  JSONB,
  security    JSONB,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Step 2: Run in Supabase SQL Editor**

Go to Supabase → SQL Editor → paste the two CREATE TABLE statements → Run.

**Step 3: Create Supabase Storage bucket**

In Supabase → Storage → New bucket:
- Name: `case-documents`
- Public: false

**Step 4: Verify**

In Supabase → Table Editor, confirm `case_documents` and `case_extracted_data` tables exist.

---

## Task 2: Python — Multi-Year Annual Reports Endpoint

**Files:**
- Modify: `/Users/gaurav/creditguardai/python-service/public_data.py`
- Modify: `/Users/gaurav/creditguardai/python-service/main.py`

**Context:** `public_data.py` already has `fetch_bse_annual_report(symbol)` which downloads ONE report. We need to extend it to fetch the last 3 years. `main.py` needs a new endpoint `/fetch-annual-reports`.

**Step 1: Add `fetch_bse_annual_reports_multi` to public_data.py**

Add after the existing `fetch_bse_annual_report` function (around line 640):

```python
def fetch_bse_annual_reports_multi(symbol: str, company_name: str = "", n_years: int = 3) -> list[dict]:
    """
    Fetch last n_years annual report PDFs from BSE for a listed company.
    Returns list of {fiscal_year, pdf_path, size_kb, source} dicts.
    Falls back to IR website scrape if BSE returns fewer than requested.
    """
    results = []
    bse_code = _get_bse_code(symbol)
    
    # ── BSE path ──────────────────────────────────────────────────────────────
    if bse_code:
        try:
            resp = httpx.get(
                "https://api.bseindia.com/BseIndiaAPI/api/AnnualReports/w",
                params={"scripcode": bse_code, "type": "Company"},
                headers={**HEADERS, "Referer": "https://www.bseindia.com/"},
                timeout=10,
            )
            resp.raise_for_status()
            filings = resp.json()
            reports = filings if isinstance(filings, list) else filings.get("Table", [])
            # Sort newest first
            reports = sorted(reports, key=lambda x: x.get("NEWDTE", ""), reverse=True)
            
            for rpt in reports[:n_years]:
                pdf_url = rpt.get("FILINGURL") or rpt.get("PDFURL") or rpt.get("pdf_url")
                if not pdf_url:
                    continue
                if not pdf_url.startswith("http"):
                    pdf_url = "https://www.bseindia.com" + pdf_url
                try:
                    pdf_resp = httpx.get(pdf_url, headers=HEADERS, timeout=120, follow_redirects=True)
                    pdf_resp.raise_for_status()
                    if len(pdf_resp.content) < 10000:
                        continue
                    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
                    tmp.write(pdf_resp.content)
                    tmp.close()
                    # Extract fiscal year from date string e.g. "31/03/2024" → "FY2024"
                    date_str = rpt.get("NEWDTE", "")
                    year = ""
                    if date_str:
                        parts = date_str.replace("-", "/").split("/")
                        for p in parts:
                            if len(p) == 4 and p.isdigit():
                                year = f"FY{p}"
                                break
                    results.append({
                        "fiscal_year": year or f"FY{2025 - len(results)}",
                        "pdf_path": tmp.name,
                        "size_kb": len(pdf_resp.content) // 1024,
                        "source": "bse",
                    })
                    logger.info(f"Downloaded BSE annual report {year}: {tmp.name}")
                except Exception as e:
                    logger.warning(f"Failed to download BSE report: {e}")
                    continue
        except Exception as e:
            logger.warning(f"BSE annual reports fetch failed: {e}")
    
    # ── IR website fallback ───────────────────────────────────────────────────
    if len(results) < n_years:
        needed = n_years - len(results)
        try:
            from ddgs import DDGS
            query = f'"{company_name or symbol}" annual report filetype:pdf investor relations site:*.com'
            with DDGS() as ddgs:
                hits = list(ddgs.text(query, max_results=10))
            pdf_urls = [h.get("href", "") for h in hits if h.get("href", "").lower().endswith(".pdf")]
            for pdf_url in pdf_urls[:needed]:
                try:
                    pdf_resp = httpx.get(pdf_url, headers=HEADERS, timeout=120, follow_redirects=True)
                    pdf_resp.raise_for_status()
                    if len(pdf_resp.content) < 10000:
                        continue
                    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
                    tmp.write(pdf_resp.content)
                    tmp.close()
                    year = f"FY{2025 - len(results)}"
                    results.append({
                        "fiscal_year": year,
                        "pdf_path": tmp.name,
                        "size_kb": len(pdf_resp.content) // 1024,
                        "source": "ir_website",
                        "source_url": pdf_url,
                    })
                    logger.info(f"Downloaded IR website report {year}: {tmp.name}")
                except Exception as e:
                    logger.warning(f"IR website PDF download failed: {e}")
                    continue
        except Exception as e:
            logger.warning(f"IR website fallback failed: {e}")
    
    return results
```

**Step 2: Add `/fetch-annual-reports` endpoint to main.py**

Add after the `/public-data/stock/{symbol}` endpoint (around line 205):

```python
@app.post("/fetch-annual-reports")
async def fetch_annual_reports_endpoint(data: dict):
    """
    Fetch last 3 annual report PDFs for a listed company (BSE → IR fallback).
    Extract financials from each PDF.
    Input: {symbol, company_name}
    Output: {reports: [{fiscal_year, size_kb, source, financials, ratios}], merged_financials}
    """
    symbol = data.get("symbol", "")
    company_name = data.get("company_name", "")
    if not symbol:
        raise HTTPException(400, "symbol is required")

    from public_data import fetch_bse_annual_reports_multi
    reports_meta = fetch_bse_annual_reports_multi(symbol, company_name, n_years=3)
    
    if not reports_meta:
        raise HTTPException(404, f"No annual reports found for {symbol}")
    
    results = []
    merged: dict = {}
    
    for meta in reports_meta:
        pdf_path = meta.get("pdf_path")
        if not pdf_path or not os.path.exists(pdf_path):
            continue
        try:
            financials = extract_financials_multi_pass(pdf_path, company_name)
            ratios = calculate_ratios(financials)
            # Merge financials: later (older) years fill gaps in merged
            if not merged:
                merged = dict(financials)
            results.append({
                "fiscal_year": meta["fiscal_year"],
                "size_kb": meta["size_kb"],
                "source": meta["source"],
                "source_url": meta.get("source_url", ""),
                "financials": financials,
                "ratios": ratios,
            })
        except Exception as e:
            logger.warning(f"Extraction failed for {meta['fiscal_year']}: {e}")
            results.append({
                "fiscal_year": meta["fiscal_year"],
                "size_kb": meta["size_kb"],
                "source": meta["source"],
                "error": str(e),
            })
        finally:
            try:
                os.unlink(pdf_path)
            except Exception:
                pass
    
    return {"reports": results, "merged_financials": merged, "company_name": company_name or symbol}
```

**Step 3: Add `/extract-organogram` endpoint to main.py**

Add after the `/fetch-annual-reports` endpoint:

```python
@app.post("/extract-organogram")
async def extract_organogram_endpoint(
    file: UploadFile = File(...),
    company_name: str = Form(default=""),
):
    """
    Extract group structure from an uploaded organogram image or PDF.
    Returns {ocr_text, entities: [{name, role, ownership_pct}]}
    """
    content = await file.read()
    fname = (file.filename or "").lower()
    suffix = ".pdf" if fname.endswith(".pdf") else ".png"
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # For PDFs: use existing extractor
        if suffix == ".pdf":
            financials = extract_financials_multi_pass(tmp_path, company_name)
            # Pull out any group structure / shareholder text
            raw_text = financials.get("raw_text", "") or str(financials)
        else:
            # For images: convert to text via pytesseract if available, else raw description
            try:
                import pytesseract
                from PIL import Image
                img = Image.open(tmp_path)
                raw_text = pytesseract.image_to_string(img)
            except ImportError:
                raw_text = f"[Image uploaded: {file.filename}. OCR not available — install pytesseract for text extraction.]"
        
        # Use LLM to parse entities from text
        prompt = f"""Extract the group organogram / corporate structure from this text.
Return JSON with keys:
- "entities": list of {{"name": str, "type": "parent|subsidiary|associate|jv", "ownership_pct": number|null, "parent": str|null}}
- "summary": 2-3 sentence plain-English description of the group structure

Text:
{raw_text[:4000]}

Respond with only valid JSON."""
        
        from cam_sections import _llm
        llm_response = _llm(prompt)
        
        try:
            import json as _json
            parsed = _json.loads(llm_response.strip().strip("```json").strip("```").strip())
        except Exception:
            parsed = {"entities": [], "summary": llm_response[:500]}
        
        return {
            "ocr_text": raw_text[:3000],
            "entities": parsed.get("entities", []),
            "summary": parsed.get("summary", ""),
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
```

**Step 4: Test the endpoint manually**

```bash
cd /Users/gaurav/creditguardai/python-service
# Should already be running on port 8001
curl -s -X POST http://localhost:8001/fetch-annual-reports \
  -H "Content-Type: application/json" \
  -d '{"symbol":"RELIANCE","company_name":"Reliance Industries"}' | python3 -m json.tool | head -30
```

Expected: JSON with `reports` array and `merged_financials`.

---

## Task 3: Express — DB Functions for Data Room

**Files:**
- Modify: `artifacts/api-server/src/lib/supabase-db.ts`

**Step 1: Add data room functions at the end of supabase-db.ts**

```typescript
// ── Case Documents ────────────────────────────────────────────────────────

export async function listCaseDocuments(caseId: number) {
  const { data, error } = await supabase
    .from("case_documents").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertCaseDocument(values: Record<string, unknown>) {
  const { data, error } = await supabase.from("case_documents").insert(values).select().single();
  if (error) throw error;
  return data;
}

export async function updateCaseDocument(id: number, values: Record<string, unknown>) {
  const { data, error } = await supabase.from("case_documents").update(values).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCaseDocument(id: number) {
  const { error } = await supabase.from("case_documents").delete().eq("id", id);
  if (error) throw error;
}

// ── Case Extracted Data ───────────────────────────────────────────────────

export async function getCaseExtractedData(caseId: number) {
  const { data } = await supabase
    .from("case_extracted_data").select("*").eq("case_id", caseId).single();
  return data ?? null;
}

export async function upsertCaseExtractedData(caseId: number, values: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("case_extracted_data")
    .upsert({ case_id: caseId, ...values, updated_at: new Date().toISOString() }, { onConflict: "case_id" })
    .select().single();
  if (error) throw error;
  return data;
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/api-server build 2>&1 | tail -5
```

Expected: `⚡ Done in Xms` with no errors.

---

## Task 4: Express — Data Room Routes

**Files:**
- Create: `artifacts/api-server/src/routes/data-room.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Step 1: Create data-room.ts**

Create `/Users/gaurav/creditguardai/frontend/artifacts/api-server/src/routes/data-room.ts`:

```typescript
import { Router } from "express";
import multer from "multer";
import {
  listCaseDocuments,
  insertCaseDocument,
  deleteCaseDocument,
  getCaseExtractedData,
  upsertCaseExtractedData,
  getCase,
  supabase,
} from "../lib/supabase-db.js";

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const PYTHON_URL = () => process.env.PYTHON_SERVICE_URL || "http://localhost:8001";

// ── GET /api/cases/:id/data-room ───────────────────────────────────────────
router.get("/:id/data-room", async (req, res) => {
  const id = Number(req.params.id);
  const [docs, extracted] = await Promise.all([
    listCaseDocuments(id),
    getCaseExtractedData(id),
  ]);

  // Compute completeness score
  const checks = [
    docs.some(d => d.doc_type === "annual_report"),
    !!(extracted?.research && (extracted.research as unknown[]).length > 0),
    !!(extracted?.peers && (extracted.peers as unknown[]).length > 0),
    docs.some(d => d.doc_type === "organogram"),
    docs.some(d => d.doc_type === "security"),
  ];
  const completeness = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  res.json({ documents: docs, extractedData: extracted, completeness });
});

// ── POST /api/cases/:id/data-room/fetch-reports ───────────────────────────
router.post("/:id/data-room/fetch-reports", async (req, res) => {
  const id = Number(req.params.id);
  const { symbol, companyName } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  const pyRes = await fetch(`${PYTHON_URL()}/fetch-annual-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, company_name: companyName || "" }),
    signal: AbortSignal.timeout(300_000),
  }).catch(e => { throw new Error(`Python service error: ${e.message}`); });

  if (!pyRes.ok) {
    const err = await pyRes.text();
    return res.status(502).json({ error: `Annual report fetch failed: ${err}` });
  }

  const pyData = await pyRes.json() as { reports: Record<string, unknown>[]; merged_financials: Record<string, unknown> };
  const { reports, merged_financials } = pyData;

  // Store each report as a case_document record
  for (const rpt of reports) {
    if (rpt.error) continue;
    await insertCaseDocument({
      case_id: id,
      doc_type: "annual_report",
      filename: `Annual Report ${rpt.fiscal_year}.pdf`,
      storage_path: `case-${id}/annual-reports/${rpt.fiscal_year}.pdf`,
      fiscal_year: rpt.fiscal_year,
      extracted_data: rpt.financials || null,
      source: rpt.source || "bse",
    });
  }

  // Save merged financials to case_extracted_data
  await upsertCaseExtractedData(id, { financials: merged_financials });

  return res.json({ ok: true, reportsFound: reports.length, reports });
});

// ── POST /api/cases/:id/data-room/run-research ────────────────────────────
router.post("/:id/data-room/run-research", async (req, res) => {
  const id = Number(req.params.id);
  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const pyRes = await fetch(`${PYTHON_URL()}/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_name: c.borrower_name, sector: c.sector }),
    signal: AbortSignal.timeout(300_000),
  }).catch(e => { throw new Error(`Research failed: ${e.message}`); });

  if (!pyRes.ok) return res.status(502).json({ error: "Research service failed" });

  const pyData = await pyRes.json() as Record<string, unknown>;

  // Load existing research and append (additive — never delete old findings)
  const existing = await getCaseExtractedData(id);
  const existingResearch: unknown[] = (existing?.research as unknown[]) || [];
  const newFindings = pyData.findings || pyData.research || pyData.brief || pyData;
  const newItems = Array.isArray(newFindings) ? newFindings : [{ content: newFindings, timestamp: new Date().toISOString() }];
  const merged = [...existingResearch, ...newItems.map((f: unknown) => ({
    ...(f as object),
    timestamp: (f as Record<string, unknown>).timestamp || new Date().toISOString(),
  }))];

  await upsertCaseExtractedData(id, { research: merged });
  return res.json({ ok: true, newItems: newItems.length, totalItems: merged.length });
});

// ── GET /api/cases/:id/data-room/peers ────────────────────────────────────
router.get("/:id/data-room/peers", async (req, res) => {
  const id = Number(req.params.id);
  const c = await getCase(id).catch(() => null);
  if (!c) return res.status(404).json({ error: "Case not found" });

  const extracted = await getCaseExtractedData(id);
  const savedPeers = (extracted?.peers as unknown[]) || [];

  // Auto-suggest peers from Python if none saved yet
  if (savedPeers.length === 0) {
    const pyRes = await fetch(
      `${PYTHON_URL()}/search-companies?q=${encodeURIComponent(c.sector)}&limit=5`,
      { signal: AbortSignal.timeout(10_000) }
    ).catch(() => null);

    if (pyRes?.ok) {
      const suggestions = await pyRes.json() as unknown[];
      return res.json({ peers: suggestions.map((s: unknown) => ({ ...(s as object), confirmed: false, suggested: true })) });
    }
  }

  return res.json({ peers: savedPeers });
});

// ── PATCH /api/cases/:id/data-room/peers ─────────────────────────────────
router.patch("/:id/data-room/peers", async (req, res) => {
  const id = Number(req.params.id);
  const { peers } = req.body;
  if (!Array.isArray(peers)) return res.status(400).json({ error: "peers must be an array" });
  await upsertCaseExtractedData(id, { peers });
  return res.json({ ok: true });
});

// ── POST /api/cases/:id/data-room/upload ─────────────────────────────────
router.post("/:id/data-room/upload", upload.single("file"), async (req, res) => {
  const id = Number(req.params.id);
  const docType = req.body.docType || "other"; // annual_report | organogram | security | kyc | cma
  const fiscalYear = req.body.fiscalYear || null;

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { buffer, originalname, mimetype } = req.file;
  const storagePath = `case-${id}/${docType}/${Date.now()}-${originalname}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("case-documents")
    .upload(storagePath, buffer, { contentType: mimetype, upsert: false });

  if (uploadError) {
    console.error("[upload] Supabase storage error:", uploadError);
    // Fallback: store without actual file — still record metadata
  }

  // For PDFs and organogram images, extract via Python
  let extractedData: Record<string, unknown> | null = null;
  const isExtractable = mimetype === "application/pdf" ||
    originalname.toLowerCase().endsWith(".xlsx") ||
    originalname.toLowerCase().endsWith(".xls");

  const isOrganogram = docType === "organogram";

  if (isOrganogram) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: mimetype }), originalname);
      formData.append("company_name", req.body.companyName || "");
      const pyRes = await fetch(`${PYTHON_URL()}/extract-organogram`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });
      if (pyRes.ok) extractedData = await pyRes.json();
    } catch (e) {
      console.error("[upload] Organogram extraction failed:", e);
    }
  } else if (isExtractable) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: mimetype }), originalname);
      formData.append("company_name", req.body.companyName || "");
      const pyRes = await fetch(`${PYTHON_URL()}/extract`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });
      if (pyRes.ok) {
        const d = await pyRes.json() as Record<string, unknown>;
        extractedData = d;
        // If this is a financial doc, merge into case_extracted_data.financials
        if (["annual_report", "cma"].includes(docType) && d.financials) {
          const existing = await getCaseExtractedData(id);
          if (!existing?.financials) {
            await upsertCaseExtractedData(id, { financials: d.financials });
          }
        }
        // If organogram-type, store in organogram field
        if (docType === "organogram" && extractedData) {
          await upsertCaseExtractedData(id, { organogram: { summary: extractedData } });
        }
      }
    } catch (e) {
      console.error("[upload] Extraction failed:", e);
    }
  }

  const doc = await insertCaseDocument({
    case_id: id,
    doc_type: docType,
    filename: originalname,
    storage_path: storagePath,
    fiscal_year: fiscalYear,
    extracted_data: extractedData,
    source: "manual",
  });

  return res.status(201).json(doc);
});

// ── DELETE /api/cases/:id/data-room/documents/:docId ─────────────────────
router.delete("/:id/data-room/documents/:docId", async (req, res) => {
  const docId = Number(req.params.docId);
  await deleteCaseDocument(docId);
  res.status(204).send();
});

// ── POST /api/cases/:id/data-room/organogram-tree ─────────────────────────
// Save manually-entered organogram tree
router.post("/:id/data-room/organogram-tree", async (req, res) => {
  const id = Number(req.params.id);
  const { tree, summary } = req.body; // tree = [{name, type, parent, ownership_pct}]
  const existing = await getCaseExtractedData(id);
  const current = (existing?.organogram as Record<string, unknown>) || {};
  await upsertCaseExtractedData(id, { organogram: { ...current, manual_tree: tree, manual_summary: summary } });
  return res.json({ ok: true });
});

export default router;
```

**Step 2: Install multer**

```bash
cd /Users/gaurav/creditguardai/frontend/artifacts/api-server
pnpm add multer @types/multer
```

**Step 3: Register route in index.ts**

In `artifacts/api-server/src/routes/index.ts`, add:

```typescript
import dataRoomRouter from "./data-room";
```

And add to the router:
```typescript
router.use("/cases", dataRoomRouter);
```

The file should look like:
```typescript
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import memosRouter from "./memos";
import dashboardRouter from "./dashboard";
import companiesRouter from "./companies";
import dataRoomRouter from "./data-room";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/cases", casesRouter);
router.use("/cases", memosRouter);
router.use("/cases", dataRoomRouter);
router.use("/dashboard", dashboardRouter);
router.use("/companies", companiesRouter);

export default router;
```

**Step 4: Build and test**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/api-server build 2>&1 | tail -5
```

Kill and restart the api-server (port 3001). Then test:

```bash
curl -s http://localhost:3001/api/cases/1/data-room | python3 -m json.tool
```

Expected: `{"documents": [], "extractedData": null, "completeness": 0}`

---

## Task 5: Express — Update Generate Endpoint to Use Extracted Data

**Files:**
- Modify: `artifacts/api-server/src/routes/memos.ts`

**Context:** The current generate endpoint calls Python with only `company_info` and a brief `research_brief` string. We need it to also pass `financials`, `research`, and `peers` from `case_extracted_data`.

**Step 1: Import getCaseExtractedData in memos.ts**

Change the import line at the top:

```typescript
import { listSections, updateSection, bulkUpdateSections, listRiskFlags, insertActivity, updateCase, getCase, getCaseExtractedData } from "../lib/supabase-db.js";
```

**Step 2: Update the generate route to include extracted data**

Replace the `financials` variable construction and `body: JSON.stringify(...)` block inside `router.post("/:id/generate", ...)`:

```typescript
  // Load any collected data from the Data Room
  const extracted = await getCaseExtractedData(id).catch(() => null);

  const financials = {
    company_info: { name: c.borrower_name, industry: c.sector, financial_year: new Date().getFullYear().toString() },
    ...(extracted?.financials as Record<string, unknown> || {}),
  };

  const researchBrief = [
    `Sector: ${c.sector}. Facility: ${c.facility_type.replace(/_/g, " ")}, INR ${Number(c.facility_amount).toLocaleString("en-IN")} Lakhs. RM: ${c.rm_name}.`,
    extracted?.research ? `\n\nResearch findings:\n${JSON.stringify(extracted.research).slice(0, 3000)}` : "",
    extracted?.organogram ? `\n\nGroup structure: ${JSON.stringify(extracted.organogram).slice(0, 1000)}` : "",
  ].join("");

  const peers = extracted?.peers || [];
```

And update the `body: JSON.stringify(...)` to:

```typescript
      body: JSON.stringify({
        financials,
        ratios: {},
        company_name: c.borrower_name,
        research_brief: researchBrief,
        peers,
      }),
```

**Step 3: Build and verify**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/api-server build 2>&1 | tail -5
```

---

## Task 6: Frontend — API Hooks for Data Room

**Files:**
- Create: `lib/api-client-react/src/data-room.ts`
- Modify: `lib/api-client-react/src/index.ts`

**Step 1: Create data-room.ts**

Create `/Users/gaurav/creditguardai/frontend/lib/api-client-react/src/data-room.ts`:

```typescript
/**
 * Data Room API hooks — hand-written (not generated by orval).
 * Follows the same pattern as generated/api.ts.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CaseDocument {
  id: number;
  caseId: number;
  docType: string;
  filename: string;
  storagePath: string;
  fiscalYear: string | null;
  extractedData: Record<string, unknown> | null;
  source: string | null;
  createdAt: string;
}

export interface DataRoomState {
  documents: CaseDocument[];
  extractedData: {
    financials?: Record<string, unknown>;
    research?: unknown[];
    peers?: unknown[];
    organogram?: Record<string, unknown>;
    security?: unknown[];
  } | null;
  completeness: number;
}

export interface Peer {
  symbol?: string;
  name: string;
  confirmed: boolean;
  suggested?: boolean;
  screenerData?: Record<string, unknown>;
}

// ── Query keys ────────────────────────────────────────────────────────────

export const getDataRoomQueryKey = (caseId: number) => ["dataRoom", caseId] as const;
export const getPeersQueryKey = (caseId: number) => ["dataRoomPeers", caseId] as const;

// ── GET data-room state ───────────────────────────────────────────────────

export const useGetDataRoom = (caseId: number) =>
  useQuery({
    queryKey: getDataRoomQueryKey(caseId),
    queryFn: () => customFetch<DataRoomState>(`/api/cases/${caseId}/data-room`),
    enabled: !!caseId,
  });

// ── POST fetch-reports ────────────────────────────────────────────────────

export const useFetchAnnualReports = () =>
  useMutation({
    mutationFn: ({ caseId, symbol, companyName }: { caseId: number; symbol: string; companyName?: string }) =>
      customFetch<{ ok: boolean; reportsFound: number; reports: unknown[] }>(`/api/cases/${caseId}/data-room/fetch-reports`, {
        method: "POST",
        body: JSON.stringify({ symbol, companyName }),
        headers: { "Content-Type": "application/json" },
      }),
  });

// ── POST run-research ─────────────────────────────────────────────────────

export const useRunResearch = () =>
  useMutation({
    mutationFn: ({ caseId }: { caseId: number }) =>
      customFetch<{ ok: boolean; newItems: number; totalItems: number }>(`/api/cases/${caseId}/data-room/run-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
  });

// ── GET peers ─────────────────────────────────────────────────────────────

export const useGetPeers = (caseId: number) =>
  useQuery({
    queryKey: getPeersQueryKey(caseId),
    queryFn: () => customFetch<{ peers: Peer[] }>(`/api/cases/${caseId}/data-room/peers`),
    enabled: !!caseId,
  });

// ── PATCH peers ───────────────────────────────────────────────────────────

export const useUpdatePeers = () =>
  useMutation({
    mutationFn: ({ caseId, peers }: { caseId: number; peers: Peer[] }) =>
      customFetch<{ ok: boolean }>(`/api/cases/${caseId}/data-room/peers`, {
        method: "PATCH",
        body: JSON.stringify({ peers }),
        headers: { "Content-Type": "application/json" },
      }),
  });

// ── POST upload ───────────────────────────────────────────────────────────

export const useUploadDocument = () =>
  useMutation({
    mutationFn: ({ caseId, file, docType, fiscalYear, companyName }: {
      caseId: number;
      file: File;
      docType: string;
      fiscalYear?: string;
      companyName?: string;
    }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      if (fiscalYear) formData.append("fiscalYear", fiscalYear);
      if (companyName) formData.append("companyName", companyName);
      return customFetch<CaseDocument>(`/api/cases/${caseId}/data-room/upload`, {
        method: "POST",
        body: formData,
      });
    },
  });

// ── DELETE document ───────────────────────────────────────────────────────

export const useDeleteDocument = () =>
  useMutation({
    mutationFn: ({ caseId, docId }: { caseId: number; docId: number }) =>
      customFetch<void>(`/api/cases/${caseId}/data-room/documents/${docId}`, { method: "DELETE" }),
  });

// ── POST organogram-tree ──────────────────────────────────────────────────

export const useSaveOrganogramTree = () =>
  useMutation({
    mutationFn: ({ caseId, tree, summary }: { caseId: number; tree: unknown[]; summary: string }) =>
      customFetch<{ ok: boolean }>(`/api/cases/${caseId}/data-room/organogram-tree`, {
        method: "POST",
        body: JSON.stringify({ tree, summary }),
        headers: { "Content-Type": "application/json" },
      }),
  });
```

**Step 2: Export from index.ts**

In `lib/api-client-react/src/index.ts`, add:

```typescript
export * from "./data-room";
```

**Step 3: Verify TypeScript is happy**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/creditguard build 2>&1 | grep -i error | head -10
```

If no errors, proceed. Fix any type errors before continuing.

---

## Task 7: Frontend — Data Room Tab on Case Detail Page

**Files:**
- Modify: `artifacts/creditguard/src/pages/cases/[id]/index.tsx`
- Create: `artifacts/creditguard/src/pages/cases/[id]/DataRoomTab.tsx`

**Step 1: Create DataRoomTab.tsx**

Create `/Users/gaurav/creditguardai/frontend/artifacts/creditguard/src/pages/cases/[id]/DataRoomTab.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDataRoom,
  useGetPeers,
  useFetchAnnualReports,
  useRunResearch,
  useUploadDocument,
  useDeleteDocument,
  useUpdatePeers,
  useSaveOrganogramTree,
  getDataRoomQueryKey,
  getPeersQueryKey,
  type Peer,
  type CaseDocument,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Download, Trash2, Upload, Search, RefreshCw,
  Loader2, Building2, Newspaper, Users, FolderOpen, CheckCircle2,
  AlertCircle, Plus, X
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function DocTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    annual_report: "Annual Report",
    organogram: "Organogram",
    security: "Security Doc",
    kyc: "KYC / Promoter",
    cma: "CMA Data",
    other: "Other",
  };
  return <span>{map[type] || type}</span>;
}

function StatusBadge({ status }: { status: "ok" | "missing" | "optional" }) {
  if (status === "ok") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">✓ Available</Badge>;
  if (status === "missing") return <Badge variant="outline" className="text-amber-600 border-amber-300">Missing</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Optional</Badge>;
}

// ── FileUploadZone ─────────────────────────────────────────────────────────

function FileUploadZone({
  caseId,
  docType,
  label,
  accept,
  companyName,
  onUploaded,
}: {
  caseId: number;
  docType: string;
  label: string;
  accept?: string;
  companyName?: string;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [fiscalYear, setFiscalYear] = useState("");
  const uploadDoc = useUploadDocument();
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    try {
      await uploadDoc.mutateAsync({ caseId, file, docType, fiscalYear: fiscalYear || undefined, companyName });
      toast({ title: "Uploaded", description: `${file.name} uploaded and extracted.` });
      onUploaded();
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      {docType === "annual_report" && (
        <Input
          placeholder="Fiscal year (e.g. FY2024)"
          value={fiscalYear}
          onChange={e => setFiscalYear(e.target.value)}
          className="h-8 text-sm w-40"
        />
      )}
      <label
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input
          type="file"
          className="hidden"
          accept={accept || ".pdf,.xlsx,.xls,.png,.jpg,.jpeg"}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {uploadDoc.isPending ? (
          <><Loader2 className="h-6 w-6 animate-spin text-primary mb-2" /><span className="text-sm text-muted-foreground">Uploading & extracting…</span></>
        ) : (
          <><Upload className="h-6 w-6 text-muted-foreground mb-2" /><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground mt-1">Drop file here or click to browse</span></>
        )}
      </label>
    </div>
  );
}

// ── FinancialsPanel ─────────────────────────────────────────────────────────

function FinancialsPanel({ caseId, companyName, documents, onRefresh }: {
  caseId: number;
  companyName: string;
  documents: CaseDocument[];
  onRefresh: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const fetchReports = useFetchAnnualReports();
  const deleteDoc = useDeleteDocument();
  const { toast } = useToast();

  const annualReports = documents.filter(d => d.docType === "annual_report");

  const handleFetch = async () => {
    if (!symbol.trim()) { toast({ title: "Enter BSE/NSE symbol", variant: "destructive" }); return; }
    try {
      const res = await fetchReports.mutateAsync({ caseId, symbol: symbol.trim(), companyName });
      toast({ title: `${res.reportsFound} report(s) fetched`, description: "Financials extracted successfully." });
      onRefresh();
    } catch {
      toast({ title: "Fetch failed", description: "Could not find annual reports. Try uploading manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="BSE/NSE Symbol (e.g. RELIANCE)"
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          className="max-w-xs"
          onKeyDown={e => e.key === "Enter" && handleFetch()}
        />
        <Button onClick={handleFetch} disabled={fetchReports.isPending}>
          {fetchReports.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Fetching…</> : <><Search className="mr-2 h-4 w-4" /> Fetch Annual Reports</>}
        </Button>
      </div>

      {annualReports.length > 0 && (
        <div className="space-y-2">
          {annualReports.map(doc => (
            <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">{doc.fiscalYear} · {doc.source?.toUpperCase()} · {doc.extractedData ? "Extracted ✓" : "No extraction"}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={async () => { await deleteDoc.mutateAsync({ caseId, docId: doc.id }); onRefresh(); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t">
        <p className="text-sm text-muted-foreground mb-2">Or upload annual report PDFs manually:</p>
        <FileUploadZone caseId={caseId} docType="annual_report" label="Upload Annual Report PDF" accept=".pdf" companyName={companyName} onUploaded={onRefresh} />
      </div>
      <FileUploadZone caseId={caseId} docType="cma" label="Upload CMA Data (Excel)" accept=".xlsx,.xls" companyName={companyName} onUploaded={onRefresh} />
    </div>
  );
}

// ── ResearchPanel ──────────────────────────────────────────────────────────

function ResearchPanel({ caseId, extractedData, onRefresh }: {
  caseId: number;
  extractedData: { research?: unknown[]; peers?: unknown[] } | null;
  onRefresh: () => void;
}) {
  const runResearch = useRunResearch();
  const updatePeers = useUpdatePeers();
  const { data: peersData, refetch: refetchPeers } = useGetPeers(caseId);
  const [newPeerName, setNewPeerName] = useState("");
  const { toast } = useToast();

  const peers: Peer[] = peersData?.peers || [];
  const research: Record<string, unknown>[] = (extractedData?.research as Record<string, unknown>[]) || [];

  const handleRunResearch = async () => {
    try {
      const res = await runResearch.mutateAsync({ caseId });
      toast({ title: "Research complete", description: `${res.newItems} new findings added.` });
      onRefresh();
    } catch {
      toast({ title: "Research failed", variant: "destructive" });
    }
  };

  const togglePeer = async (peer: Peer) => {
    const updated = peers.map(p => p.name === peer.name ? { ...p, confirmed: !p.confirmed } : p);
    await updatePeers.mutateAsync({ caseId, peers: updated });
    refetchPeers();
  };

  const addPeer = async () => {
    if (!newPeerName.trim()) return;
    const updated = [...peers, { name: newPeerName.trim(), confirmed: true }];
    await updatePeers.mutateAsync({ caseId, peers: updated });
    setNewPeerName("");
    refetchPeers();
  };

  const removePeer = async (name: string) => {
    const updated = peers.filter(p => p.name !== name);
    await updatePeers.mutateAsync({ caseId, peers: updated });
    refetchPeers();
  };

  return (
    <div className="space-y-6">
      <div>
        <Button onClick={handleRunResearch} disabled={runResearch.isPending}>
          {runResearch.isPending
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running research…</>
            : <><RefreshCw className="mr-2 h-4 w-4" /> Run Research</>}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">Searches news, credit ratings, regulatory filings, and promoter records. Findings are additive — re-running adds new items.</p>
      </div>

      {research.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3">Research Findings ({research.length})</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {research.map((item, i) => (
              <div key={i} className="p-3 bg-muted/30 rounded-lg border text-sm">
                <p className="text-xs text-muted-foreground mb-1">
                  {item.timestamp ? new Date(item.timestamp as string).toLocaleString() : ""}
                </p>
                <p className="line-clamp-3">{item.content as string || item.brief as string || JSON.stringify(item).slice(0, 200)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-3">Peer Companies</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {peers.map(peer => (
            <div
              key={peer.name}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${
                peer.confirmed
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted border-border text-muted-foreground"
              }`}
              onClick={() => togglePeer(peer)}
            >
              {peer.confirmed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {peer.name}
              <button onClick={e => { e.stopPropagation(); removePeer(peer.name); }} className="ml-1 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Add peer company…"
            value={newPeerName}
            onChange={e => setNewPeerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPeer()}
            className="max-w-xs h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={addPeer}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

// ── DocumentsPanel ─────────────────────────────────────────────────────────

function DocumentsPanel({ caseId, companyName, documents, onRefresh }: {
  caseId: number;
  companyName: string;
  documents: CaseDocument[];
  onRefresh: () => void;
}) {
  const [manualTree, setManualTree] = useState("");
  const saveTree = useSaveOrganogramTree();
  const deleteDoc = useDeleteDocument();
  const { toast } = useToast();

  const organogramDocs = documents.filter(d => d.docType === "organogram");
  const securityDocs = documents.filter(d => d.docType === "security");
  const kycDocs = documents.filter(d => d.docType === "kyc");

  const handleSaveTree = async () => {
    try {
      await saveTree.mutateAsync({ caseId, tree: [], summary: manualTree });
      toast({ title: "Organogram saved" });
      onRefresh();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Organogram */}
      <div>
        <h4 className="text-sm font-semibold mb-3">Group Organogram</h4>
        <div className="space-y-3">
          <FileUploadZone caseId={caseId} docType="organogram" label="Upload Organogram (PDF or Image)" accept=".pdf,.png,.jpg,.jpeg" companyName={companyName} onUploaded={onRefresh} />
          {organogramDocs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border text-sm">
              <span>{doc.filename}</span>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await deleteDoc.mutateAsync({ caseId, docId: doc.id }); onRefresh(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Or describe the group structure manually:</p>
            <Textarea
              placeholder="Parent: ABC Holdings (100%) → Subsidiary: XYZ Ltd (51%), Associate: PQR Co (26%)…"
              value={manualTree}
              onChange={e => setManualTree(e.target.value)}
              className="min-h-[100px] text-sm"
            />
            <Button size="sm" className="mt-2" onClick={handleSaveTree} disabled={!manualTree.trim() || saveTree.isPending}>
              {saveTree.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Structure
            </Button>
          </div>
        </div>
      </div>

      {/* Security Documents */}
      <div>
        <h4 className="text-sm font-semibold mb-3">Security Documents</h4>
        <FileUploadZone caseId={caseId} docType="security" label="Upload Valuation Report / Charge Document" accept=".pdf" companyName={companyName} onUploaded={onRefresh} />
        {securityDocs.map(doc => (
          <div key={doc.id} className="flex items-center justify-between p-3 mt-2 bg-muted/30 rounded-lg border text-sm">
            <span>{doc.filename}</span>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await deleteDoc.mutateAsync({ caseId, docId: doc.id }); onRefresh(); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* KYC (optional) */}
      <div>
        <h4 className="text-sm font-semibold mb-1">KYC / Promoter Docs <span className="text-xs text-muted-foreground font-normal">(optional)</span></h4>
        <FileUploadZone caseId={caseId} docType="kyc" label="Upload PAN / Promoter CV (optional)" accept=".pdf,.png,.jpg" companyName={companyName} onUploaded={onRefresh} />
        {kycDocs.map(doc => (
          <div key={doc.id} className="flex items-center justify-between p-3 mt-2 bg-muted/30 rounded-lg border text-sm">
            <span>{doc.filename}</span>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { await deleteDoc.mutateAsync({ caseId, docId: doc.id }); onRefresh(); }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SummaryPanel ───────────────────────────────────────────────────────────

function SummaryPanel({ completeness, documents, extractedData }: {
  completeness: number;
  documents: CaseDocument[];
  extractedData: DataRoomState["extractedData"];
}) {
  const rows = [
    {
      label: "Annual Reports",
      status: documents.filter(d => d.docType === "annual_report").length > 0 ? "ok" : "missing",
      detail: documents.filter(d => d.docType === "annual_report").map(d => d.fiscalYear || d.filename).join(", ") || "Not fetched",
    },
    {
      label: "Research & News",
      status: (extractedData?.research?.length || 0) > 0 ? "ok" : "missing",
      detail: `${extractedData?.research?.length || 0} finding(s)`,
    },
    {
      label: "Peer Companies",
      status: (extractedData?.peers as Peer[] || []).filter((p: Peer) => p.confirmed).length > 0 ? "ok" : "missing",
      detail: (extractedData?.peers as Peer[] || []).filter((p: Peer) => p.confirmed).map((p: Peer) => p.name).join(", ") || "None confirmed",
    },
    {
      label: "Group Organogram",
      status: documents.filter(d => d.docType === "organogram").length > 0 || extractedData?.organogram ? "ok" : "missing",
      detail: documents.filter(d => d.docType === "organogram").length > 0 ? "Uploaded" : extractedData?.organogram ? "Manual entry" : "Not provided",
    },
    {
      label: "Security Documents",
      status: documents.filter(d => d.docType === "security").length > 0 ? "ok" : "optional",
      detail: documents.filter(d => d.docType === "security").length > 0 ? `${documents.filter(d => d.docType === "security").length} doc(s)` : "Not uploaded",
    },
    {
      label: "KYC / Promoter Docs",
      status: "optional" as const,
      detail: documents.filter(d => d.docType === "kyc").length > 0 ? "Uploaded" : "Not uploaded",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm font-medium mb-2">
          <span>Data Completeness</span>
          <span>{completeness}%</span>
        </div>
        <Progress value={completeness} className="h-3" />
        <p className="text-xs text-muted-foreground mt-1">Higher completeness = richer AI-generated CAM sections</p>
      </div>
      <div className="divide-y">
        {rows.map(row => (
          <div key={row.label} className="py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.detail}</p>
            </div>
            <StatusBadge status={row.status as "ok" | "missing" | "optional"} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main DataRoomTab Export ───────────────────────────────────────────────

type DataRoomPanel = "financials" | "research" | "documents" | "summary";

import type { DataRoomState } from "@workspace/api-client-react";

export default function DataRoomTab({ caseId, companyName }: { caseId: number; companyName: string }) {
  const [activePanel, setActivePanel] = useState<DataRoomPanel>("financials");
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useGetDataRoom(caseId);

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getDataRoomQueryKey(caseId) });
  };

  if (isLoading) return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
    </div>
  );

  const { documents = [], extractedData = null, completeness = 0 } = data || {};

  const panels = [
    { key: "financials" as const, label: "Financials", icon: Building2 },
    { key: "research" as const, label: "Research & News", icon: Newspaper },
    { key: "documents" as const, label: "Documents", icon: FolderOpen },
    { key: "summary" as const, label: `Summary · ${completeness}%`, icon: CheckCircle2 },
  ];

  return (
    <div className="flex h-full">
      {/* Panel nav */}
      <div className="w-48 shrink-0 border-r bg-muted/10 p-3 space-y-1">
        {panels.map(p => (
          <button
            key={p.key}
            onClick={() => setActivePanel(p.key)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
              activePanel === p.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <p.icon className="h-4 w-4 shrink-0" />
            {p.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activePanel === "financials" && (
          <FinancialsPanel caseId={caseId} companyName={companyName} documents={documents} onRefresh={handleRefresh} />
        )}
        {activePanel === "research" && (
          <ResearchPanel caseId={caseId} extractedData={extractedData} onRefresh={handleRefresh} />
        )}
        {activePanel === "documents" && (
          <DocumentsPanel caseId={caseId} companyName={companyName} documents={documents} onRefresh={handleRefresh} />
        )}
        {activePanel === "summary" && (
          <SummaryPanel completeness={completeness} documents={documents} extractedData={extractedData} />
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add Data Room tab to case detail index.tsx**

In `artifacts/creditguard/src/pages/cases/[id]/index.tsx`:

Add import at top:
```tsx
import DataRoomTab from "./DataRoomTab";
```

Add state for active main tab (after existing state declarations):
```tsx
const [mainTab, setMainTab] = useState<"memo" | "dataroom">("memo");
```

Replace the tab bar in the header (add after the progress bar, before the closing `</div>` of the sticky header):
```tsx
        {/* Main tab bar */}
        <div className="mt-4 flex gap-1 border-b -mb-px">
          {[
            { key: "memo" as const, label: "CAM Memo" },
            { key: "dataroom" as const, label: `Data Room · ${/* completeness would come from data room hook */ ""}` },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setMainTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                mainTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.key === "memo" ? "CAM Memo" : "Data Room"}
            </button>
          ))}
        </div>
```

Replace the main content area (the `<div className="flex-1 overflow-hidden">` block) to conditionally render the data room or memo:

```tsx
      <div className="flex-1 overflow-hidden">
        {mainTab === "dataroom" ? (
          <DataRoomTab caseId={id} companyName={caseData.borrowerName} />
        ) : (
          <div className="h-full flex flex-col lg:flex-row">
            {/* ... existing memo editor and sidebar ... */}
          </div>
        )}
      </div>
```

**Step 3: Fix the duplicate type import in DataRoomTab.tsx**

The file has `import type { DataRoomState }` twice (once inline and once at the top). Remove the inline one — keep only the top-level import from `@workspace/api-client-react`.

**Step 4: Run the frontend dev server and verify**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/creditguard dev
```

Open http://localhost:5173 → click a case → you should see "CAM Memo" and "Data Room" tabs.

---

## Task 8: Final Wiring — Rebuild and Smoke Test

**Step 1: Rebuild api-server**

```bash
cd /Users/gaurav/creditguardai/frontend
pnpm --filter @workspace/api-server build 2>&1 | tail -5
```

**Step 2: Restart api-server**

```bash
lsof -ti:3001 | xargs kill -9
cd /Users/gaurav/creditguardai/frontend/artifacts/api-server && \
  SUPABASE_URL=https://citgdrwspttdsqsujzzs.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=sb_secret_pCiny7dFQmUxrtUAvdBQBQ_d-_9R2XO \
  PYTHON_SERVICE_URL=http://localhost:8001 PORT=3001 \
  node --enable-source-maps ./dist/index.mjs &
```

**Step 3: Smoke test all new endpoints**

```bash
# Data room state
curl -s http://localhost:3001/api/cases/1/data-room | python3 -m json.tool

# Fetch annual reports (RELIANCE as test)
curl -s -X POST http://localhost:3001/api/cases/1/data-room/fetch-reports \
  -H "Content-Type: application/json" \
  -d '{"symbol":"RELIANCE","companyName":"Reliance Industries"}' | python3 -m json.tool | head -20

# Run research
curl -s -X POST http://localhost:3001/api/cases/1/data-room/run-research \
  -H "Content-Type: application/json" | python3 -m json.tool

# Get peers
curl -s http://localhost:3001/api/cases/1/data-room/peers | python3 -m json.tool
```

**Step 4: Verify Data Room tab in browser**

1. Open http://localhost:5173
2. Click a case
3. Click "Data Room" tab
4. Enter "RELIANCE" in the symbol field → click "Fetch Annual Reports"
5. Switch to Research → click "Run Research"
6. Check Summary tab shows updated completeness %
7. Click back to CAM Memo → click "Generate AI Draft" — should now use the fetched data

Expected: sections generate with real Reliance financial data instead of generic placeholders.

---

## Notes

- **No tests**: This codebase has no test infrastructure set up. Manual smoke tests per task are sufficient.
- **Supabase Storage errors**: If the `case-documents` bucket doesn't exist, the upload endpoint logs a warning but still stores document metadata — the feature degrades gracefully.
- **pytesseract**: Image OCR in the organogram endpoint requires `pytesseract` and `Pillow`. If not installed, it falls back to a placeholder message. Install with `pip install pytesseract pillow` in the python-service venv if needed.
- **multer**: Must be installed before building the api-server (`pnpm add multer @types/multer` inside `artifacts/api-server/`).
