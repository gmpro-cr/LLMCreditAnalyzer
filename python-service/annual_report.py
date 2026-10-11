"""Annual-report analyser: the latest filed annual report -> structured credit facts.

A listed company's annual report carries most of what a detailed CAM needs and
Screener does not: the group structure with holdings (Form AOC-1), credit-rating
grades, each borrowing's terms and repayment schedule, contingent liabilities,
related-party transactions, the auditor's observations, board composition and
the business narrative.

Pipeline (deterministic page-finding, then one small LLM extraction per topic):
  download (cap 80 MB) -> text per page (pypdfium2, ~1 s / 270 pages, ~75 MB RSS)
  -> score pages per topic by keyword hits -> top pages' text (capped) -> LLM JSON
  -> amounts normalised to ₹ crore in Python (the report states its unit).
Every extracted item keeps the page numbers it came from, so the CAM can cite them.
"""
import json
import logging
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

MAX_BYTES = 80 * 1024 * 1024
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

# ₹ per unit, to convert reported figures to crore.
UNIT_TO_CRORE = {"crore": 1.0, "lakh": 0.01, "million": 0.1, "thousand": 0.0001, "rupee": 1e-7}

# topic -> (keyword regexes, max pages, char cap)
TOPICS: Dict[str, tuple] = {
    "group": ([r"AOC[- ]?I\b|AOC[- ]?1", r"salient features", r"% of [Hh]olding", r"% equity interest",
               r"[Pp]rincipal place of business", r"[Ss]tep[- ]down", r"[Jj]oint [Vv]enture", r"[Ss]ubsidiar"], 4, 26000),
    "ratings": ([r"[Cc]redit [Rr]ating", r"\bCRISIL\b", r"\bICRA\b", r"\bCARE\b", r"India Ratings",
                 r"[Rr]eaffirmed", r"\(Stable\)|Stable"], 2, 8000),
    "borrowings": ([r"[Tt]erm loan", r"[Rr]epayment schedule|[Rr]epayable", r"[Ii]nstal+ment",
                    r"\b[Ss]ecured\b", r"[Uu]nsecured", r"[Dd]ebentures", r"[Ee]xternal [Cc]ommercial",
                    r"T-Bill|MCLR|repo rate|SOFR|EURIBOR", r"[Ww]orking capital (loan|demand)"], 5, 26000),
    # The disclosure table, not the accounting-policy pages that merely define the term.
    "contingent": ([r"Contingent liabilities\s+(In|\(|`|₹|Rs)", r"not acknowledged as [Dd]ebts?",
                    r"[Gg]uarantees given by the (Company|Group).{0,4}s? [Bb]ankers|[Cc]orporate [Gg]uarantee",
                    r"[Ii]ncome[- ][Tt]ax|[Ee]xcise|[Cc]ustoms|GST|[Ss]ales [Tt]ax",
                    r"[Cc]apital commitments|[Ee]stimated amount of contracts"], 3, 14000),
    "related_party": ([r"[Rr]elated [Pp]art", r"Key Management Personnel", r"[Ll]oans? given",
                       r"[Gg]uarantees? given", r"[Ss]ale of goods|[Pp]urchase of goods"], 3, 16000),
    "auditor": ([r"Independent Auditor", r"Basis for (Qualified )?Opinion", r"Key Audit Matter",
                 r"Emphasis of Matter", r"[Qq]ualified [Oo]pinion|[Aa]dverse [Oo]pinion",
                 r"statutory dues", r"Auditor.s Report\) Order"], 5, 22000),
    "board": ([r"Independent Director", r"Non[- ]Executive", r"\bDIN\b", r"[Cc]ategory",
               r"Managing Director", r"[Cc]omposition of the Board"], 3, 12000),
    "business": ([r"Management Discussion", r"[Ss]egment", r"[Cc]apacity", r"[Oo]rder book|[Oo]rders",
                  r"[Ee]xports?", r"[Cc]ustomers", r"[Rr]evenue", r"[Oo]utlook", r"[Cc]apex|[Cc]apital expenditure"], 6, 26000),
    "industry": ([r"[Ii]ndustry", r"[Dd]emand", r"[Gg]lobal econom|[Ii]ndian econom", r"[Oo]utlook", r"[Mm]arket"], 3, 14000),
}

_UNIT_NOTE = ("For every amount, also report the unit the report states for that table "
              "(one of: crore, lakh, million, thousand, rupee) in the item's \"unit\" field. "
              "Copy numbers exactly as printed (no conversion).")

PROMPTS: Dict[str, str] = {
    "group": (
        "From these annual-report pages (Form AOC-1 and notes on group entities), list EVERY "
        "subsidiary, step-down subsidiary, joint venture and associate. Return JSON: "
        "{\"entities\":[{\"name\":str,\"relation\":\"subsidiary|joint venture|associate\","
        "\"country\":str|null,\"reporting_currency\":str|null,\"holding_pct\":number|null,\"held_through\":str|null,"
        "\"turnover\":number|null,\"profit_after_tax\":number|null,\"capital_plus_reserves\":number|null,"
        "\"total_assets\":number|null,\"business\":str|null,\"unit\":str|null}],"
        "\"notes\":[str]}. capital_plus_reserves = share capital + reserves. " + _UNIT_NOTE
    ),
    "ratings": (
        "Extract the company's credit ratings. Return JSON: {\"ratings\":[{\"agency\":str,"
        "\"facility\":str,\"rating\":str,\"outlook\":str|null,\"action\":str|null,"
        "\"amount\":number|null,\"unit\":str|null,\"as_of\":str|null}]}."
    ),
    "borrowings": (
        "Extract the borrowing profile from the notes on borrowings. Return JSON: "
        "{\"basis\":\"consolidated|standalone\",\"instruments\":[{\"type\":str,\"secured\":bool|null,"
        "\"lender\":str|null,\"amount\":number|null,\"pricing\":str|null,\"repayment\":str|null,"
        "\"security\":str|null,\"covenant_or_trigger\":str|null,\"unit\":str|null}],"
        "\"security_summary\":str|null,\"notes\":[str]}. Include term loans, debentures, ECBs, "
        "working-capital loans, packing credit and commercial paper. " + _UNIT_NOTE
    ),
    "contingent": (
        "Extract contingent liabilities and commitments. Return JSON: {\"basis\":\"consolidated|standalone\","
        "\"items\":[{\"nature\":str,\"current_year\":number|null,\"previous_year\":number|null,\"unit\":str|null}],"
        "\"capital_commitments\":number|null,\"capital_commitments_unit\":str|null,\"notes\":[str]}. " + _UNIT_NOTE
    ),
    "related_party": (
        "Summarise related-party transactions. Return JSON: {\"basis\":\"consolidated|standalone\","
        "\"items\":[{\"party\":str,\"relationship\":str|null,\"nature\":str,\"amount\":number|null,"
        "\"unit\":str|null}],\"notes\":[str]}. Keep the 15 largest items; include loans, investments "
        "and guarantees given to group entities and KMP remuneration. " + _UNIT_NOTE
    ),
    "auditor": (
        "From the independent auditor's reports (and the CARO annexure), return JSON: "
        "{\"auditor\":str|null (the audit firm, e.g. from 'For XYZ & Co. LLP, Chartered Accountants'),\"opinion\":\"unmodified|qualified|adverse|disclaimer\"|null,"
        "\"qualifications\":[str],\"emphasis_of_matter\":[str],\"key_audit_matters\":[str],"
        "\"caro_observations\":[str],\"caro_confirmations\":[str],\"going_concern_issue\":bool|null}. "
        "caro_confirmations: the auditor's positive CARO statements on loans, e.g. 'no default in repayment of "
        "loans or interest to lenders', 'not declared a wilful defaulter', 'term loans applied for the stated "
        "purpose', 'short-term funds not used for long-term purposes'. "
        "caro_observations: only adverse remarks (delayed statutory dues, defaults, fraud, "
        "short-term funds used for long-term purposes); empty list if none."
    ),
    "board": (
        "List the Board of Directors. Return JSON: {\"directors\":[{\"name\":str,"
        "\"designation\":str|null,\"category\":str|null,\"din\":str|null}],"
        "\"key_managerial_personnel\":[{\"name\":str,\"designation\":str}]}."
    ),
    "business": (
        "From the management discussion / business review, return JSON: {\"overview\":str,"
        "\"segments\":[{\"name\":str,\"revenue\":number|null,\"share_pct\":number|null,\"comment\":str|null,"
        "\"unit\":str|null}],\"geography\":[{\"region\":str,\"share_pct\":number|null,\"comment\":str|null}],"
        "\"plants_and_capacity\":[str],\"key_customers\":[str],\"order_book\":str|null,"
        "\"capex_plans\":str|null,\"highlights\":[str],\"risks\":[str],\"outlook\":str|null}. "
        "Use only what the pages state; highlights are concrete facts with numbers. " + _UNIT_NOTE
    ),
    "industry": (
        "Summarise the industry discussion. Return JSON: {\"industry\":str|null,\"overview\":[str],"
        "\"demand_drivers\":[str],\"headwinds\":[str],\"outlook\":str|null}. Facts with numbers where given."
    ),
}


def download(url: str) -> str:
    """Stream the PDF to a temp file (size-capped); returns the path."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    size = 0
    try:
        with os.fdopen(fd, "wb") as fh, httpx.stream("GET", url, headers=HEADERS, timeout=120,
                                                    follow_redirects=True) as r:
            r.raise_for_status()
            for chunk in r.iter_bytes(1 << 16):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError(f"annual report exceeds {MAX_BYTES // (1 << 20)} MB")
                fh.write(chunk)
    except Exception:
        os.unlink(path)
        raise
    return path


def page_texts(path: str) -> List[str]:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(path)
    out = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            tp = page.get_textpage()
            out.append(tp.get_text_range() or "")
            tp.close()
            page.close()
    finally:
        doc.close()
    return out


def select_pages(texts: List[str], patterns: List[str], max_pages: int) -> List[int]:
    """Indices of the best-matching pages (distinct-keyword count, then total hits),
    returned in document order."""
    scored = []
    for i, t in enumerate(texts):
        hits = [len(re.findall(p, t)) for p in patterns]
        distinct = sum(1 for h in hits if h)
        if distinct >= 2:
            scored.append((distinct, sum(hits), i))
    scored.sort(reverse=True)
    return sorted(i for _, _, i in scored[:max_pages])


def _parse_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def to_crore(value, unit) -> Optional[float]:
    """Reported amount -> ₹ crore. Unknown unit -> None (never guess the scale)."""
    if value is None:
        return None
    try:
        v = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    u = str(unit or "").strip().lower()
    u = {"crores": "crore", "cr": "crore", "lakhs": "lakh", "millions": "million", "mn": "million",
         "thousands": "thousand", "rupees": "rupee", "rs": "rupee", "inr": "rupee"}.get(u, u)
    factor = UNIT_TO_CRORE.get(u)
    return round(v * factor, 2) if factor is not None else None


def _normalise(topic: str, data: dict) -> dict:
    """Convert reported amounts to ₹ crore (keeps the raw value + unit too)."""
    def conv(item: dict, fields: List[str], unit_key: str = "unit"):
        for f in fields:
            if f in item:
                item[f + "_cr"] = to_crore(item.get(f), item.get(unit_key))
    if topic == "group":
        for e in data.get("entities", []) or []:
            conv(e, ["turnover", "profit_after_tax", "capital_plus_reserves", "total_assets"])
    elif topic == "borrowings":
        for e in data.get("instruments", []) or []:
            conv(e, ["amount"])
    elif topic == "contingent":
        for e in data.get("items", []) or []:
            conv(e, ["current_year", "previous_year"])
        data["capital_commitments_cr"] = to_crore(data.get("capital_commitments"),
                                                  data.get("capital_commitments_unit"))
    elif topic == "related_party":
        for e in data.get("items", []) or []:
            conv(e, ["amount"])
    elif topic == "ratings":
        for e in data.get("ratings", []) or []:
            conv(e, ["amount"])
    elif topic == "business":
        for e in data.get("segments", []) or []:
            conv(e, ["revenue"])
    return data


def analyse_texts(texts: List[str], company_name: str, llm: Callable[[str], str],
                  workers: int = 3) -> Dict[str, Any]:
    """Topic extraction over already-extracted page texts (no I/O besides the LLM)."""
    result: Dict[str, Any] = {"pages": len(texts), "topics": {}, "pages_used": {}}
    jobs = {}
    for topic, (patterns, max_pages, cap) in TOPICS.items():
        idx = select_pages(texts, patterns, max_pages)
        if idx:
            chunk = "\n\n".join(f"[page {i + 1}]\n{texts[i]}" for i in idx)[:cap]
            jobs[topic] = (idx, chunk)

    def run(topic: str):
        idx, chunk = jobs[topic]
        prompt = (f"Company: {company_name}\nAnnual report pages:\n{chunk}\n\n---\n{PROMPTS[topic]}\n"
                  "Return ONLY the JSON object. Use null where the pages do not say.")
        try:
            data = _parse_json(llm(prompt))
        except Exception as e:  # noqa: BLE001 — one bad topic must not sink the rest
            logger.warning(f"[AR] {topic} extraction failed: {e}")
            data = None
        return topic, idx, data

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for topic, idx, data in pool.map(run, list(jobs)):
            if data:
                result["topics"][topic] = _normalise(topic, data)
                result["pages_used"][topic] = [i + 1 for i in idx]
    # The audit firm signs the reports ("For B S R & Co. LLP / Chartered Accountants");
    # the signature page is rarely among the selected auditor pages.
    aud = result["topics"].get("auditor")
    if aud is not None and not aud.get("auditor"):
        for t in texts:
            m = re.search(r"For\s+([A-Z][\w&.,' ]{2,60}?(?:LLP|& Co\.?|& Associates|Associates))\s*\n?\s*Chartered Accountants", t)
            if m:
                aud["auditor"] = m.group(1).strip()
                break
    head = " ".join(texts[:3])
    fy = re.search(r"(20\d{2})\s*[-–]\s*(\d{2,4})", head)
    result["fiscal_year"] = f"FY{fy.group(1)[:2]}{fy.group(2)[-2:]}" if fy else None
    return result


def analyse(url: str, company_name: str, llm: Callable[[str], str], workers: int = 3) -> Dict[str, Any]:
    """Download + analyse one annual report."""
    path = download(url)
    try:
        texts = page_texts(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    result = analyse_texts(texts, company_name, llm, workers)
    result["source_url"] = url
    return result


def group_structure_from(ar: Dict[str, Any], company_name: str, promoter_pct: Optional[float] = None,
                         promoter_group: Optional[str] = None) -> Dict[str, Any]:
    """Organogram data model from the analysed report. `verified` stays False until
    the RM confirms it in the Data Room."""
    ents = []
    seen = set()
    for e in ((ar.get("topics") or {}).get("group") or {}).get("entities", []) or []:
        name = (e.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        rel = (e.get("relation") or "subsidiary").lower()
        rel = "joint venture" if "joint" in rel else "associate" if "assoc" in rel else "subsidiary"
        ents.append({
            "name": name, "relation": rel, "country": e.get("country"),
            "currency": e.get("reporting_currency"),
            "holding_pct": e.get("holding_pct"), "held_through": e.get("held_through"),
            "business": e.get("business"), "turnover_cr": e.get("turnover_cr"),
            "pat_cr": e.get("profit_after_tax_cr"), "net_worth_cr": e.get("capital_plus_reserves_cr"),
        })
    return {
        "borrower": company_name,
        "promoter_group": promoter_group,
        "promoter_holding_pct": promoter_pct,
        "entities": ents,
        "source": "annual_report",
        "source_url": ar.get("source_url"),
        "pages": (ar.get("pages_used") or {}).get("group", []),
        "verified": False,
    }
