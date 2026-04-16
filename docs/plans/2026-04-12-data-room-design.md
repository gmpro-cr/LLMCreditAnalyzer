# Data Room — Design Document

**Goal:** Add a "Data Room" tab to the case detail page where RMs can auto-fetch public data, upload documents, and collect structured inputs that feed the AI CAM generation.

**Architecture:** New tab on case detail page with four panels (Financials, Research & News, Documents, Data Summary). Two new Supabase tables store file metadata and extracted structured data. The Generate AI Draft button passes all collected data to the Python service instead of just bare case fields.

**Tech Stack:** React (existing Vite frontend), Express API server (existing), Python FastAPI service (existing), Supabase Storage (file uploads), BSE/NSE filing APIs + web scraping (annual report fetch)

---

## Panel 1: Financials — Annual Report Extraction

**Trigger:** RM enters BSE code or NSE symbol (auto-detected from borrower name via search, editable). Clicks "Fetch Annual Reports".

**Backend flow:**
1. Query BSE filing portal (`bseindia.com/xml-data/corpfiling/`) or NSE EDGAR for last 3 annual report PDFs
2. Fallback: Google-search `"{company}" annual report filetype:pdf site:investor`, scrape IR page for PDF links
3. Download and store 3 PDFs in Supabase Storage (labeled FY2024/FY2023/FY2022)
4. Run each through existing `/extract` endpoint (multi-pass LLM extraction)
5. Merge 3 years of P&L, balance sheet, cash flow, shareholding pattern into one structured object
6. Save to `case_extracted_data.financials`; mark `financial_analysis` and `working_capital_analysis` sections as "data available"

**Fallback:** RM can manually upload PDFs if auto-fetch misses a year.

**Shareholding pattern** is extracted from the annual report PDFs automatically — no separate upload needed.

---

## Panel 2: Research & News + Peer Comparison

**Research trigger:** RM clicks "Run Research". Calls existing `/research` endpoint (iterative DDG web search loop).

**Fetched data:**
- Recent news (last 12 months) — regulatory actions, management changes, expansions, defaults, litigation
- Industry outlook — sector-specific trends
- Credit ratings — CRISIL/ICRA/CARE if publicly available
- Promoter background — public records and news mentions of key directors

**Additive runs:** Each research run appends new findings — old findings are never deleted. Each card is timestamped. RM can dismiss individual cards but a re-run never wipes existing data.

**Peer Companies:**
1. System auto-suggests 3–5 peers from sector + facility type
2. RM sees suggested list, can tick/cross each, and add custom companies
3. Screener.in financials fetched for confirmed peers (revenue, EBITDA margin, D/E, ROE)
4. Feeds `peer_comparison` CAM section

**UI:** Two sub-sections — "Research Findings" (collapsible timestamped cards) and "Peer Companies" (editable chip list + comparison table preview).

---

## Panel 3: Documents

**Group Organogram:**
- Upload image (PNG/JPG) or PDF → displayed inline
- OCR extract → entity names and relationships → pre-fills `group_organogram` CAM section
- Manual entry → RM types entity tree (parent → subsidiaries → associates) → rendered as visual tree diagram
- All three modes available; they are additive

**Security Documents:**
- Upload property valuation reports, charge documents, hypothecation deeds
- Labelled by type; key fields extracted (property address, valuation amount, charge type)
- Feeds `proposed_structure` CAM section

**KYC / Promoter Docs (optional):**
- No mandatory gate — RM uploads only if available
- Extracted promoter names + DIN pre-fill `promoter_background` section
- Shareholding pattern comes from annual reports, not here

All files stored in Supabase Storage. Metadata + extracted text saved to `case_documents` table.

---

## Panel 4: Data Summary

Read-only dashboard showing collection status:

| Data Type | Status | Last Updated |
|---|---|---|
| Annual Reports (FY24, FY23, FY22) | ✅ / ⚠️ / ❌ | timestamp |
| Research & News | ✅ N findings | timestamp |
| Peer Companies | ✅ N confirmed | timestamp |
| Group Organogram | ✅ / not uploaded | timestamp |
| Security Docs | ✅ / not uploaded | — |
| KYC Docs | — Optional | — |

**Completeness score** shown in the tab header (e.g. "Data Room · 72%") — informational only, never a blocker.

---

## Generate AI Draft Integration

When RM clicks Generate, the Express `POST /api/cases/:id/generate` endpoint now:
1. Reads `case_extracted_data` for the case
2. Passes full structured financials (3 years), research brief, peer table, organogram text, and security details to Python `/cam/draft-sections`
3. All 12 CAM sections receive real data instead of just bare case fields

---

## Database Schema Additions

```sql
CREATE TABLE case_documents (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doc_type      TEXT NOT NULL, -- 'annual_report', 'organogram', 'security', 'kyc', 'cma'
  filename      TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  fiscal_year   TEXT,          -- 'FY2024' etc, for annual reports
  extracted_text TEXT,
  extracted_data JSONB,
  source        TEXT,          -- 'bse', 'nse', 'ir_website', 'manual'
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE case_extracted_data (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE UNIQUE,
  financials    JSONB,         -- merged 3-year P&L, BS, CF, ratios, shareholding
  research      JSONB,         -- array of {title, content, source, timestamp}
  peers         JSONB,         -- array of {name, screener_data, confirmed}
  organogram    JSONB,         -- {image_url, ocr_text, manual_tree}
  security      JSONB,         -- array of {type, description, valuation, doc_id}
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## New API Endpoints

**Express (api-server):**
- `POST /api/cases/:id/data-room/fetch-reports` — trigger BSE/NSE → IR website annual report fetch
- `POST /api/cases/:id/data-room/run-research` — trigger research loop
- `GET  /api/cases/:id/data-room/peers` — get peer suggestions + confirmed peers
- `PATCH /api/cases/:id/data-room/peers` — update confirmed peers
- `POST /api/cases/:id/data-room/upload` — upload document (multipart)
- `GET  /api/cases/:id/data-room` — get full data room state

**Python service (new):**
- `POST /fetch-annual-reports` — BSE/NSE search + IR fallback + PDF download
- `POST /extract-organogram` — OCR + entity extraction from organogram image/PDF
