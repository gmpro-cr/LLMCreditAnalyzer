"""
CreditGuard AI — Python Analysis Service
FastAPI backend: PDF extraction, ratio computation, CAM memo generation, Word export.
"""
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import tempfile
import os
import asyncio
import json
import logging
import httpx
from dotenv import load_dotenv

from extractor import extract_financials_multi_pass, extract_excel_cma
from ratios import calculate_ratios, evaluate_covenants
from memo import generate_cam_memo, export_to_docx
from researcher import run_research
from public_data import fetch_all_public_data, fetch_stock_quote, fetch_screener_financials, fetch_bse_annual_reports_multi
from cam_sections import generate_cam_sections, _llm
from risk_flags import generate_risk_flags

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CreditGuard AI Analysis Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    extraction = os.getenv("EXTRACTION_PROVIDER", "gemini")
    memo = os.getenv("MEMO_PROVIDER", "gemini")
    model = os.getenv("OLLAMA_MODEL", "")
    return {"status": "healthy", "extraction_provider": extraction, "memo_provider": memo, "ollama_model": model}


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

    logger.info(f"Extracting: {file.filename} ({len(content)/1024/1024:.1f} MB) company={company_name!r}")

    suffix = ".pdf" if is_pdf else ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if is_excel:

            financials = extract_excel_cma(tmp_path, company_name)
        else:
            financials = extract_financials_multi_pass(tmp_path, company_name)
        ratios = calculate_ratios(financials)
        logger.info(f"Extraction complete. Ratios computed: {list(ratios.keys())}")
        return {"financials": financials, "ratios": ratios, "company_name": company_name or financials.get("company_info", {}).get("name", "")}
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        raise HTTPException(500, f"Extraction failed: {str(e)}")
    finally:
        os.unlink(tmp_path)


@app.get("/search-companies")
async def search_companies(q: str = "", limit: int = 8):
    """
    Search for listed companies by name or symbol using Yahoo Finance.
    Returns structured list for the Add Borrower autocomplete dropdown.
    """
    if not q or len(q.strip()) < 2:
        return []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://query2.finance.yahoo.com/v1/finance/search",
                params={
                    "q": q.strip(),
                    "lang": "en-US",
                    "region": "IN",
                    "quotesCount": limit,
                    "newsCount": 0,
                    "enableFuzzyQuery": False,
                    "enableCb": False,
                },
                headers={"User-Agent": "Mozilla/5.0 (compatible; CreditGuardAI/1.0)"},
            )
        resp.raise_for_status()
        data = resp.json()
        results = []
        seen_symbols: set = set()
        for q_item in data.get("quotes", []):
            if q_item.get("quoteType") != "EQUITY":
                continue
            symbol = q_item.get("symbol", "")
            # Only include NSE (.NS) and BSE (.BO) Indian equities
            if not (symbol.endswith(".NS") or symbol.endswith(".BO")):
                continue
            clean_symbol = symbol.replace(".NS", "").replace(".BO", "")
            # Prefer .NS over .BO — skip .BO if we already have .NS
            if clean_symbol in seen_symbols:
                continue
            seen_symbols.add(clean_symbol)
            results.append({
                "symbol": clean_symbol,
                "full_symbol": symbol,
                "name": q_item.get("longname") or q_item.get("shortname") or clean_symbol,
                "exchange": "NSE" if symbol.endswith(".NS") else "BSE",
                "industry": q_item.get("industry") or q_item.get("sector") or "",
                "sector": q_item.get("sector") or "",
            })
        return results[:limit]
    except Exception as e:
        logger.warning(f"Company search failed: {e}")
        return []


@app.post("/public-data/fetch")
async def fetch_public_data(data: dict):
    """
    Fetch all public data for a listed company: stock quote, Screener financials,
    peer comparison, and optionally download + process the latest annual report.
    Input: {symbol, company_name, industry, process_annual_report (bool)}
    """
    symbol       = data.get("symbol", "").strip().upper()
    company_name = data.get("company_name", "")
    industry     = data.get("industry", "Manufacturing")
    process_ar   = data.get("process_annual_report", False)

    if not symbol and not company_name:
        raise HTTPException(400, "symbol or company_name is required")

    try:
        pub = fetch_all_public_data(symbol, company_name, industry)

        result = {
            "symbol":              pub["symbol"],
            "is_listed":           pub["is_listed"],
            "stock":               pub["stock"],
            "screener":            pub["screener"],
            "screener_financials": pub.get("screener_financials", {}),
            "peers":               pub["peers"],
            "financials":          None,
            "ratios":              None,
            "memo_content":        None,
        }

        # Optionally process the downloaded annual report through the full pipeline
        ar_path = pub.get("annual_report_path")
        if process_ar and ar_path:
            try:
                financials   = extract_financials_multi_pass(ar_path, company_name)
                ratios       = calculate_ratios(financials)
                research     = run_research(company_name, industry)
                memo_content = generate_cam_memo(financials, ratios, company_name,
                                                  research_brief=research.get("brief", ""))
                result["financials"]   = financials
                result["ratios"]       = ratios
                result["memo_content"] = memo_content
            finally:
                try:
                    os.unlink(ar_path)
                except Exception:
                    pass

        return result
    except Exception as e:
        logger.error(f"Public data fetch failed: {e}", exc_info=True)
        raise HTTPException(500, f"Public data fetch failed: {str(e)}")


@app.get("/public-data/stock/{symbol}")
async def get_stock_quote(symbol: str):
    """Live stock quote for a symbol (NSE/BSE)."""
    try:
        quote = fetch_stock_quote(symbol)
        if not quote:
            raise HTTPException(404, f"No stock data found for {symbol}")
        return quote
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/fetch-annual-reports")
async def fetch_annual_reports_endpoint(data: dict):
    """
    Fetch last 3 annual report PDFs for a listed company (BSE → IR fallback).
    Extract financials from each PDF.
    Input: {symbol, company_name}
    Output: {reports: [{fiscal_year, size_kb, source, financials, ratios}], merged_financials, company_name}
    """
    symbol = data.get("symbol", "")
    company_name = data.get("company_name", "")
    if not symbol:
        raise HTTPException(400, "symbol is required")

    reports_meta = await asyncio.to_thread(fetch_bse_annual_reports_multi, symbol, company_name, 3)

    if not reports_meta:
        raise HTTPException(404, f"No annual reports found for {symbol}")

    results = []

    for meta in reports_meta:
        pdf_path = meta.get("pdf_path")
        if not pdf_path or not os.path.exists(pdf_path):
            continue
        try:
            financials = await asyncio.to_thread(extract_financials_multi_pass, pdf_path, company_name)
            ratios = calculate_ratios(financials)
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

    # Build multi-year merged structure (Screener-compatible format)
    valid = sorted(
        [r for r in results if "financials" in r and "error" not in r],
        key=lambda x: x["fiscal_year"]
    )

    # Also try Screener for authoritative multi-year data
    screener_data: dict = {}
    try:
        screener_data = await asyncio.to_thread(fetch_screener_financials, symbol, company_name)
    except Exception as e:
        logger.warning(f"Screener fetch failed alongside PDF extraction: {e}")

    if screener_data and screener_data.get("profit_loss", {}).get("years"):
        # Screener has proper multi-year arrays — use as primary merged source
        merged = screener_data
        merged["source"] = "screener+pdf"
        # Overlay latest-year detailed data from PDF extraction (notes, WC, cash flow)
        if valid:
            latest_fin = valid[-1]["financials"]
            for key in ("notes_analysis", "cash_flow"):
                if latest_fin.get(key):
                    merged[key] = latest_fin[key]
    elif valid:
        # Build multi-year structure from PDF extractions
        years = [r["fiscal_year"] for r in valid]

        def _get_pl(r, *keys):
            d = r.get("financials", {}).get("profit_loss", {})
            for k in keys:
                if not isinstance(d, dict):
                    return None
                d = d.get(k)
            return d

        def _get_bs(r, *keys):
            d = r.get("financials", {}).get("balance_sheet", {})
            for k in keys:
                if not isinstance(d, dict):
                    return None
                d = d.get(k)
            return d

        revenue_arr = [
            _get_pl(r, "revenue", "revenue_from_operations") or _get_pl(r, "revenue", "total_income")
            for r in valid
        ]
        pat_arr = [_get_pl(r, "profit_metrics", "profit_after_tax") for r in valid]
        ebitda_arr = [_get_pl(r, "profit_metrics", "ebitda") for r in valid]
        pbt_arr = [_get_pl(r, "profit_metrics", "profit_before_tax") for r in valid]
        interest_arr = [_get_pl(r, "expenses", "finance_costs") for r in valid]
        dep_arr = [_get_pl(r, "expenses", "depreciation_amortization") for r in valid]
        total_assets_arr = [_get_bs(r, "assets", "total_assets") for r in valid]
        equity_arr = [_get_bs(r, "equity", "total_equity") for r in valid]
        borrowings_arr = [
            (_get_bs(r, "liabilities", "non_current_liabilities", "long_term_borrowings") or 0)
            + (_get_bs(r, "liabilities", "current_liabilities", "short_term_borrowings") or 0)
            for r in valid
        ]

        latest = valid[-1]["financials"]
        merged = {
            "source": "pdf_extraction",
            "company_info": latest.get("company_info", {}),
            "profit_loss": {
                "years": years,
                "revenue": revenue_arr,
                "pat": pat_arr,
                "ebitda": ebitda_arr,
                "pbt": pbt_arr,
                "interest": interest_arr,
                "depreciation": dep_arr,
                # Scalar aliases for backward compat
                "revenue_from_operations": {"current": revenue_arr[-1] if revenue_arr else None},
                "profit_after_tax": {"current": pat_arr[-1] if pat_arr else None},
                "finance_costs": {"current": interest_arr[-1] if interest_arr else None},
            },
            "balance_sheet": {
                "years": years,
                "total_assets": total_assets_arr,
                "borrowings": borrowings_arr,
                "total_equity": equity_arr,
                # Full latest-year nested structure for ratio calculations
                **{k: v for k, v in latest.get("balance_sheet", {}).items()
                   if k not in ("years", "total_assets", "borrowings", "total_equity")},
            },
            "cash_flow": latest.get("cash_flow", {}),
            "notes_analysis": latest.get("notes_analysis", {}),
        }
    else:
        merged = {}

    return {"reports": results, "merged_financials": merged, "company_name": company_name or symbol}


@app.post("/extract-organogram")
async def extract_organogram_endpoint(
    file: UploadFile = File(...),
    company_name: str = Form(default=""),
):
    """
    Extract group structure from an uploaded organogram image or PDF.
    Returns {ocr_text, entities, summary}
    """
    content = await file.read()
    fname = (file.filename or "").lower()
    suffix = ".pdf" if fname.endswith(".pdf") else ".png"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if suffix == ".pdf":
            financials = extract_financials_multi_pass(tmp_path, company_name)
            raw_text = str(financials)[:4000]
        else:
            try:
                import pytesseract
                from PIL import Image
                img = Image.open(tmp_path)
                raw_text = pytesseract.image_to_string(img)
            except ImportError:
                raw_text = f"[Image uploaded: {file.filename}. Install pytesseract for OCR.]"

        prompt = f"""Extract the group organogram / corporate structure from this text.
Return JSON with keys:
- "entities": list of {{"name": str, "type": "parent|subsidiary|associate|jv", "ownership_pct": number|null, "parent": str|null}}
- "summary": 2-3 sentence plain-English description of the group structure

Text:
{raw_text[:4000]}

Respond with only valid JSON."""

        llm_response = _llm(prompt)
        try:
            cleaned = llm_response.strip().strip("```json").strip("```").strip()
            parsed = json.loads(cleaned)
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


@app.post("/public-data/generate-memo")
async def generate_memo_from_public_data(data: dict):
    """
    Full auto-analysis for a listed company using only public data.
    Fetches Screener.in financials → computes ratios → runs web research → generates CAM memo.
    No PDF upload required. Input: {symbol, company_name, industry}
    """
    symbol       = data.get("symbol", "").strip().upper()
    company_name = data.get("company_name", "")
    industry     = data.get("industry", "Manufacturing")

    if not symbol and not company_name:
        raise HTTPException(400, "symbol or company_name is required")

    try:
        # Step 1: Fetch Screener financials (rich structured data)
        logger.info(f"[PublicMemo] Step 1: Fetching Screener data for {symbol or company_name}")
        screener_fin = fetch_screener_financials(symbol, company_name)
        if not screener_fin or not screener_fin.get("profit_loss", {}).get("revenue_from_operations", {}).get("current"):
            raise HTTPException(404, f"Could not fetch financial data for {symbol or company_name}. "
                                     "Company may not be listed or not found on Screener.in.")

        # Step 2: Compute ratios from screener data
        logger.info(f"[PublicMemo] Step 2: Computing ratios")
        ratios = calculate_ratios(screener_fin)

        # Enrich ratios with Screener's own computed ratios
        kr = screener_fin.get("key_ratios_from_screener", {})
        if kr.get("roce_pct"):     ratios.setdefault("roce", kr["roce_pct"])
        if kr.get("roe_pct"):      ratios.setdefault("roe", kr["roe_pct"])
        if kr.get("debtor_days"):  ratios.setdefault("debtor_days", kr["debtor_days"])
        if kr.get("inventory_days"): ratios.setdefault("inventory_days", kr["inventory_days"])
        if kr.get("interest_coverage"): ratios.setdefault("interest_coverage_ratio", kr["interest_coverage"])
        if kr.get("debt_equity_ratio"): ratios.setdefault("debt_equity_ratio", kr["debt_equity_ratio"])

        # Step 3: Web research (best-effort)
        logger.info(f"[PublicMemo] Step 3: Running web research")
        research_brief   = ""
        research_sources = []
        research_queries = []
        try:
            pl = screener_fin.get("profit_loss", {})
            bs = screener_fin.get("balance_sheet", {})
            research = run_research(company_name or symbol, industry, {
                "years":   pl.get("years", []),
                "revenue": pl.get("revenue", []),
                "pat":     pl.get("pat", []),
                "debt":    bs.get("borrowings", []),
            })
            research_brief    = research.get("brief", "")
            research_sources  = research.get("sources", [])
            research_queries  = research.get("queries_run", [])
            research_rounds   = research.get("round_summaries", [])
        except Exception as re_err:
            logger.warning(f"[PublicMemo] Research failed (non-fatal): {re_err}")

        # Step 4: Generate CAM memo
        logger.info(f"[PublicMemo] Step 4: Generating credit memo")
        cname = company_name or screener_fin.get("company_info", {}).get("name", symbol)
        memo_content = generate_cam_memo(
            screener_fin, ratios, cname,
            research_brief=research_brief,
        )

        # Embed research metadata into financials so it persists with the upload
        if research_brief:
            screener_fin["_research"] = {
                "brief":                       research_brief,
                "sources":                     research_sources,
                "queries_run":                 research_queries,
                "round_summaries":             research_rounds,
                "research_completeness_score": research.get("research_completeness_score", 0),
                "dimension_scores":            research.get("dimension_scores", {}),
            }

        # Step 5: Fetch live stock quote
        stock = fetch_stock_quote(symbol)

        return {
            "symbol":           symbol,
            "company_name":     cname,
            "is_listed":        True,
            "source":           "screener",
            "financials":       screener_fin,
            "ratios":           ratios,
            "memo_content":     memo_content,
            "stock":            stock,
            "research_used":    bool(research_brief),
            "research_brief":   research_brief,
            "research_sources": research_sources,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PublicMemo] Failed: {e}", exc_info=True)
        raise HTTPException(500, f"Auto-analysis failed: {str(e)}")


@app.post("/research")
async def research_company(data: dict):
    """
    Autoresearch agent: run web research on a company and return a Research Brief.
    Also fetches Screener.in multi-year financials for the company (best-effort).
    Input: {company_name, sector/industry, financials_snapshot (optional)}
    Output: {brief, sources, queries_run, financials (if found on Screener)}
    """
    company_name = data.get("company_name", "")
    industry     = data.get("industry", "") or data.get("sector", "Manufacturing")
    snapshot     = data.get("financials_snapshot", {})

    if not company_name:
        raise HTTPException(400, "company_name is required")

    try:
        # Run web research (async-safe via thread)
        result = await asyncio.to_thread(run_research, company_name, industry, snapshot)

        # Also fetch Screener financials in parallel (best-effort)
        screener_fin: dict = {}
        try:
            screener_fin = await asyncio.to_thread(fetch_screener_financials, company_name, company_name)
        except Exception as se:
            logger.warning(f"[Research] Screener fetch failed: {se}")

        if screener_fin and screener_fin.get("profit_loss", {}).get("years"):
            result["financials"] = screener_fin

        return result
    except Exception as e:
        logger.error(f"Research failed: {e}", exc_info=True)
        raise HTTPException(500, f"Research failed: {str(e)}")


@app.post("/generate-memo")
async def generate_memo(data: dict):
    """
    Step 2 of pipeline: Given extracted financials + ratios, generate SBI CAM memo.
    Optionally accepts research_brief to enrich memo narrative with web intelligence.
    """
    financials     = data.get("financials", {})
    ratios         = data.get("ratios", {})
    company_name   = data.get("company_name", "Unknown Borrower")
    covenants      = data.get("covenants", [])
    research_brief = data.get("research_brief", "")

    if not financials:
        raise HTTPException(400, "financials is required")

    try:
        memo_content = generate_cam_memo(financials, ratios, company_name, covenants, research_brief)
        return {"memo_content": memo_content, "company_name": company_name}
    except Exception as e:
        logger.error(f"Memo generation failed: {e}", exc_info=True)
        raise HTTPException(500, f"Memo generation failed: {str(e)}")


@app.post("/export-docx")
async def export_docx_endpoint(data: dict):
    """Export memo text to .docx and return the file."""
    memo_content = data.get("memo_content", "")
    company_name = data.get("company_name", "Borrower")
    if not memo_content:
        raise HTTPException(400, "memo_content is required")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
        tmp_path = tmp.name

    try:
        export_to_docx(memo_content, company_name, tmp_path)
        safe_name = company_name.replace(" ", "_").replace("/", "-")
        return FileResponse(
            tmp_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"CAM_{safe_name}.docx",
            background=None,
        )
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        logger.error(f"DOCX export failed: {e}", exc_info=True)
        raise HTTPException(500, f"DOCX export failed: {str(e)}")


@app.post("/export-pdf")
async def export_pdf_endpoint(data: dict):
    """Export memo text to PDF and return the file."""
    memo_content = data.get("memo_content", "")
    company_name = data.get("company_name", "Borrower")
    if not memo_content:
        raise HTTPException(400, "memo_content is required")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp_path = tmp.name

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

        doc = SimpleDocTemplate(tmp_path, pagesize=A4,
            leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle('Title', parent=styles['Title'],
            textColor=colors.HexColor('#0D1B2A'), fontSize=18, spaceAfter=12)
        story.append(Paragraph(f"Credit Appraisal Memorandum — {company_name}", title_style))
        story.append(Spacer(1, 0.5*cm))

        heading2_style = ParagraphStyle('H2', parent=styles['Heading2'],
            textColor=colors.HexColor('#0D1B2A'), fontSize=13, spaceBefore=16, spaceAfter=6)
        body_style = ParagraphStyle('Body', parent=styles['Normal'],
            fontSize=10, leading=16, spaceAfter=8)

        for line in memo_content.split('\n'):
            line = line.strip()
            if not line:
                story.append(Spacer(1, 0.2*cm))
            elif line.startswith('## '):
                story.append(Paragraph(line[3:], heading2_style))
            elif line.startswith('# '):
                story.append(Paragraph(line[2:], title_style))
            else:
                line = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                story.append(Paragraph(line, body_style))

        footer_style = ParagraphStyle('Footer', parent=styles['Normal'],
            fontSize=8, textColor=colors.grey, spaceBefore=20)
        story.append(Paragraph("AI-assisted draft — reviewed and approved by RM — CreditGuard AI — CONFIDENTIAL",
            footer_style))
        doc.build(story)

        safe_name = company_name.replace(" ", "_").replace("/", "-")
        return FileResponse(
            tmp_path,
            media_type="application/pdf",
            filename=f"CAM_{safe_name}.pdf",
            background=None,
        )
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        logger.error(f"PDF export failed: {e}", exc_info=True)
        raise HTTPException(500, f"PDF export failed: {str(e)}")


@app.post("/cam/draft-sections")
async def draft_cam_sections_endpoint(data: dict):
    """
    Generate AI-drafted CAM note sections for a borrower.
    Input: {financials, ratios, company_name, research_brief (opt), regenerate (opt section key)}
    Output: {sections: {section_key: {content, user_edited, ai_generated, ...}}}
    """
    financials     = data.get("financials", {})
    ratios         = data.get("ratios", {})
    company_name   = data.get("company_name", "Unknown Borrower")
    research_brief = data.get("research_brief", "")
    regenerate     = data.get("regenerate")   # single section key or None

    if not financials:
        raise HTTPException(400, "financials is required")

    try:
        logger.info(f"[CAM] Drafting sections for {company_name}, regenerate={regenerate!r}")
        sections = generate_cam_sections(financials, ratios, company_name, research_brief, regenerate)
        return {"sections": sections, "company_name": company_name}
    except Exception as e:
        logger.error(f"CAM section generation failed: {e}", exc_info=True)
        raise HTTPException(500, f"CAM section generation failed: {str(e)}")


@app.post("/evaluate-covenants")
async def evaluate_covenants_endpoint(data: dict):
    """
    Evaluate covenant conditions against current ratios.
    Input: {ratios: {...}, covenants: [{ratio_name, operator, threshold}]}
    """
    ratios    = data.get("ratios", {})
    covenants = data.get("covenants", [])
    if not ratios:
        raise HTTPException(400, "ratios is required")

    results = evaluate_covenants(ratios, covenants)
    breach_count = sum(1 for r in results if r.get("is_breached"))
    return {"results": results, "breach_count": breach_count, "total": len(results)}


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


@app.post("/analyze")
async def analyze_full(
    file: UploadFile = File(...),
    company_name: str = Form(default=""),
    generate_memo_flag: str = Form(default="true"),
):
    """
    Full pipeline in one call: extract → compute ratios → generate CAM memo.
    Returns financials, ratios, and memo_content.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")

    content = await file.read()
    if len(content) < 1000:
        raise HTTPException(400, "File too small")

    logger.info(f"Full analysis: {file.filename} ({len(content)/1024/1024:.1f} MB)")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        financials = extract_financials_multi_pass(tmp_path, company_name)
        ratios = calculate_ratios(financials)
        cname = company_name or financials.get("company_info", {}).get("name", "Unknown Borrower")

        memo_content = ""
        if generate_memo_flag.lower() == "true":
            memo_content = generate_cam_memo(financials, ratios, cname)

        return {
            "financials": financials,
            "ratios": ratios,
            "memo_content": memo_content,
            "company_name": cname,
        }
    except Exception as e:
        logger.error(f"Full analysis failed: {e}", exc_info=True)
        raise HTTPException(500, f"Analysis failed: {str(e)}")
    finally:
        os.unlink(tmp_path)
