"""Deep Screener.in fetch for a CMA-style spread. No LLM.

The company page gives only top-level lines (Borrowings, Other Assets, ...). The
schedules API behind each "+" button breaks them into the items a credit spread
needs: long/short-term borrowings, trade payables, inventories, receivables,
cash, gross block, cost structure, exceptional items and working-capital
movements. Quarterly results and the category-wise shareholding come from the
same page.

Schedules API quirk (verified 2026-10-11): passing `consolidated` with ANY value
returns consolidated figures; omitting it returns standalone.
"""
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

SCREENER_BASE = "https://www.screener.in"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
N_YEARS = 5
N_QUARTERS = 5

# (parent row, page section) -> expanded on the schedules API
_SCHEDULES = [
    ("Borrowings", "balance-sheet"),
    ("Other Liabilities", "balance-sheet"),
    ("Other Assets", "balance-sheet"),
    ("Fixed Assets", "balance-sheet"),
    ("Expenses", "profit-loss"),
    ("Other Income", "profit-loss"),
    ("Cash from Operating Activity", "cash-flow"),
    ("Cash from Investing Activity", "cash-flow"),
]

_YEAR_RE = re.compile(r"^Mar \d{4}$")


def num(val) -> Optional[float]:
    """'1,812' -> 1812.0, '16.11%' -> 16.11, '-0' -> 0.0, '' / '-' -> None."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = re.sub(r"[,\s%₹]", "", str(val))
    if s in ("", "-", "--", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _table(soup, section_id: str) -> Dict[str, Dict[str, str]]:
    """{row label: {column header: cell text}} for a Screener section table."""
    sec = soup.find("section", id=section_id) if soup else None
    tbl = sec.find("table") if sec else None
    if not tbl:
        return {}
    rows = tbl.find_all("tr")
    if len(rows) < 2:
        return {}
    heads = [th.get_text(" ", strip=True) for th in rows[0].find_all("th")]
    out: Dict[str, Dict[str, str]] = {}
    for tr in rows[1:]:
        tds = tr.find_all("td")
        if not tds:
            continue
        label = tds[0].get_text(" ", strip=True).replace("+", "").strip()
        if label:
            out[label] = dict(zip(heads[1:], [td.get_text(" ", strip=True) for td in tds[1:]]))
    return out


def _series(row: Dict[str, Any], periods: List[str]) -> List[Optional[float]]:
    return [num((row or {}).get(p)) for p in periods]


def fetch_schedules(company_id: str, consolidated: bool) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """{parent: {item: {period: value}}}. Best effort — a failed parent is skipped."""
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for parent, section in _SCHEDULES:
        params = {"parent": parent, "section": section}
        if consolidated:
            params["consolidated"] = "true"
        try:
            r = httpx.get(f"{SCREENER_BASE}/api/company/{company_id}/schedules/",
                          params=params, headers=HEADERS, timeout=15)
            r.raise_for_status()
            data = r.json()
        except Exception as e:  # noqa: BLE001 — schedules are enrichment only
            logger.warning(f"[ScreenerDeep] schedule {parent} failed: {e}")
            continue
        if isinstance(data, dict):
            out[parent] = {k: v for k, v in data.items() if isinstance(v, dict)}
    return out


def _sched(sched: Dict, parent: str, item: str, years: List[str]) -> List[Optional[float]]:
    """A schedule line as a year series; matches the item label case-insensitively."""
    rows = sched.get(parent) or {}
    for k, v in rows.items():
        if k.strip().lower() == item.lower():
            return _series(v, years)
    return [None] * len(years)


def _add(*series: List[Optional[float]]) -> List[Optional[float]]:
    out = []
    for vals in zip(*series):
        nums = [v for v in vals if v is not None]
        out.append(round(sum(nums), 2) if nums else None)
    return out


def build_spread(soup, sched: Dict, basis: str) -> Dict[str, Any]:
    """Annual spread (last N_YEARS), quarterly results and shareholding."""
    pl, bs, cf, rat = (_table(soup, s) for s in ("profit-loss", "balance-sheet", "cash-flow", "ratios"))
    sales_row = pl.get("Sales") or pl.get("Revenue") or {}
    years = sorted([k for k in sales_row if _YEAR_RE.match(k)], key=lambda k: int(k[-4:]))[-N_YEARS:]
    if not years:
        return {}

    def p(label):
        return _series(pl.get(label, {}), years)

    def b(label):
        return _series(bs.get(label, {}), years)

    def c(label):
        return _series(cf.get(label, {}), years)

    rows: Dict[str, List[Optional[float]]] = {
        # P&L
        "sales": p("Sales") if pl.get("Sales") else p("Revenue"),
        "expenses": p("Expenses"),
        "ebitda": p("Operating Profit"),
        "opm_pct": p("OPM %"),
        "other_income": p("Other Income"),
        "exceptional_items": _sched(sched, "Other Income", "Exceptional items", years),
        "other_income_normal": _sched(sched, "Other Income", "Other income normal", years),
        "interest": p("Interest"),
        "depreciation": p("Depreciation"),
        "pbt": p("Profit before tax"),
        "tax_pct": p("Tax %"),
        "pat": p("Net Profit"),
        "eps": p("EPS in Rs"),
        "dividend_payout_pct": p("Dividend Payout %"),
        # cost structure (% of sales)
        "material_cost_pct": _sched(sched, "Expenses", "Material Cost %", years),
        "manufacturing_cost_pct": _sched(sched, "Expenses", "Manufacturing Cost %", years),
        "employee_cost_pct": _sched(sched, "Expenses", "Employee Cost %", years),
        "other_cost_pct": _sched(sched, "Expenses", "Other Cost %", years),
        # Balance sheet
        "equity_capital": b("Equity Capital"),
        "reserves": b("Reserves"),
        "borrowings": b("Borrowings"),
        "lt_borrowings": _sched(sched, "Borrowings", "Long term Borrowings", years),
        "st_borrowings": _sched(sched, "Borrowings", "Short term Borrowings", years),
        "lease_liabilities": _sched(sched, "Borrowings", "Lease Liabilities", years),
        "other_liabilities": b("Other Liabilities"),
        "trade_payables": _sched(sched, "Other Liabilities", "Trade Payables", years),
        "advance_from_customers": _sched(sched, "Other Liabilities", "Advance from Customers", years),
        "other_liability_items": _sched(sched, "Other Liabilities", "Other liability items", years),
        "non_controlling_interest": _sched(sched, "Other Liabilities", "Non controlling int", years),
        "total_liabilities": b("Total Liabilities"),
        "net_block": b("Fixed Assets"),
        # "Gross Block" is a header row in the schedule; the block is its components.
        "gross_block": _add(*[_sched(sched, "Fixed Assets", item, years) for item in (
            "Land", "Building", "Plant Machinery", "Equipments", "Furniture n fittings",
            "Railway sidings", "Vehicles", "Intangible Assets", "Other fixed assets")]),
        "accumulated_depreciation": _sched(sched, "Fixed Assets", "Accumulated Depreciation", years),
        "cwip": b("CWIP"),
        "investments": b("Investments"),
        "other_assets": b("Other Assets"),
        "inventories": _sched(sched, "Other Assets", "Inventories", years),
        "receivables": _sched(sched, "Other Assets", "Trade receivables", years),
        "cash": _sched(sched, "Other Assets", "Cash Equivalents", years),
        "loans_advances": _sched(sched, "Other Assets", "Loans n Advances", years),
        "other_asset_items": _sched(sched, "Other Assets", "Other asset items", years),
        "total_assets": b("Total Assets"),
        # Cash flow
        "cfo": c("Cash from Operating Activity"),
        "cfi": c("Cash from Investing Activity"),
        "cff": c("Cash from Financing Activity"),
        "net_cash_flow": c("Net Cash Flow"),
        "wc_receivables": _sched(sched, "Cash from Operating Activity", "Receivables", years),
        "wc_inventory": _sched(sched, "Cash from Operating Activity", "Inventory", years),
        "wc_payables": _sched(sched, "Cash from Operating Activity", "Payables", years),
        "direct_taxes": _sched(sched, "Cash from Operating Activity", "Direct taxes", years),
        "capex_fixed_assets": _add(_sched(sched, "Cash from Investing Activity", "Fixed assets purchased", years),
                                   _sched(sched, "Cash from Investing Activity", "Fixed assets sold", years)),
        # Screener ratios
        "debtor_days": _series(rat.get("Debtor Days", {}), years),
        "inventory_days": _series(rat.get("Inventory Days", {}), years),
        "payable_days": _series(rat.get("Days Payable", {}), years),
        "cash_conversion_cycle": _series(rat.get("Cash Conversion Cycle", {}), years),
        "working_capital_days": _series(rat.get("Working Capital Days", {}), years),
        "roce_pct": _series(rat.get("ROCE %", {}), years),
    }
    rows["net_worth"] = _add(rows["equity_capital"], rows["reserves"])

    ttm = {}
    if "TTM" in sales_row:
        ttm = {"sales": num(sales_row.get("TTM")), "pat": num((pl.get("Net Profit") or {}).get("TTM")),
               "ebitda": num((pl.get("Operating Profit") or {}).get("TTM"))}

    return {
        "basis": basis,
        "years": years,
        "rows": rows,
        "ttm": ttm,
        "quarters": _quarters(soup),
        "shareholding": _shareholding(soup),
    }


def _quarters(soup) -> Dict[str, Any]:
    q = _table(soup, "quarters")
    sales = q.get("Sales") or q.get("Revenue") or {}
    periods = [k for k in sales if re.match(r"^[A-Z][a-z]{2} \d{4}$", k)]
    if not periods:
        return {}
    # Keep the last N plus the same quarter a year earlier for YoY comparisons.
    keep = periods[-(N_QUARTERS + 4):]
    return {
        "periods": keep,
        "rows": {
            "sales": _series(sales, keep),
            "expenses": _series(q.get("Expenses", {}), keep),
            "ebitda": _series(q.get("Operating Profit", {}), keep),
            "opm_pct": _series(q.get("OPM %", {}), keep),
            "other_income": _series(q.get("Other Income", {}), keep),
            "interest": _series(q.get("Interest", {}), keep),
            "depreciation": _series(q.get("Depreciation", {}), keep),
            "pbt": _series(q.get("Profit before tax", {}), keep),
            "pat": _series(q.get("Net Profit", {}), keep),
        },
    }


def _shareholding(soup) -> Dict[str, Any]:
    """Quarterly shareholding by category (Promoters, FIIs, DIIs, Government, Public)."""
    sec = soup.find("section", id="shareholding") if soup else None
    node = sec.find(id="quarterly-shp") if sec else None
    tbl = (node or sec).find("table") if (node or sec) else None
    if not tbl:
        return {}
    rows = tbl.find_all("tr")
    heads = [th.get_text(" ", strip=True) for th in rows[0].find_all("th")][1:]
    keep = heads[-N_QUARTERS:]
    data: Dict[str, List[Optional[float]]] = {}
    for tr in rows[1:]:
        tds = tr.find_all("td")
        if not tds:
            continue
        label = tds[0].get_text(" ", strip=True).replace("+", "").strip()
        vals = dict(zip(heads, [td.get_text(" ", strip=True) for td in tds[1:]]))
        data[label] = _series(vals, keep)
    return {"periods": keep, "rows": data}


def segment_names(company_id: str) -> Dict[str, List[str]]:
    """Reported segment names (business, geography). Values need Screener premium,
    so only the names are used — the RM supplies the split."""
    from bs4 import BeautifulSoup
    out: Dict[str, List[str]] = {}
    for segtype, key in (("1", "business"), ("2", "geography")):
        try:
            r = httpx.get(f"{SCREENER_BASE}/api/segments/{company_id}/profit-loss/{segtype}/",
                          headers=HEADERS, timeout=15)
            r.raise_for_status()
        except Exception:
            continue
        names: List[str] = []
        for tr in BeautifulSoup(r.text, "html.parser").find_all("tr")[1:]:
            cell = tr.find(["td", "th"])
            label = cell.get_text(" ", strip=True) if cell else ""
            low = label.lower()
            if low.startswith("sales growth"):
                break  # the second block repeats the same names
            if not label or low.startswith(("sales", "less", "profit", "please")):
                continue
            if label not in names:
                names.append(label)
        if names:
            out[key] = names
    return out


def standalone_summary(soup) -> Dict[str, Any]:
    """Five-year headline figures of the borrower entity (standalone page)."""
    pl, bs = _table(soup, "profit-loss"), _table(soup, "balance-sheet")
    sales_row = pl.get("Sales") or pl.get("Revenue") or {}
    years = sorted([k for k in sales_row if _YEAR_RE.match(k)], key=lambda k: int(k[-4:]))[-N_YEARS:]
    if not years:
        return {}
    return {
        "years": years,
        "rows": {
            "sales": _series(sales_row, years),
            "ebitda": _series(pl.get("Operating Profit", {}), years),
            "interest": _series(pl.get("Interest", {}), years),
            "pat": _series(pl.get("Net Profit", {}), years),
            "borrowings": _series(bs.get("Borrowings", {}), years),
            "net_worth": _add(_series(bs.get("Equity Capital", {}), years), _series(bs.get("Reserves", {}), years)),
            "investments": _series(bs.get("Investments", {}), years),
        },
    }


def page_basis(html: str) -> str:
    """Screener labels the figures 'Consolidated Figures' / 'Standalone Figures'."""
    m = re.search(r"(Consolidated|Standalone)\s+Figures", html or "")
    return m.group(1) if m else "Standalone"


def fetch_deep(slug: str) -> Dict[str, Any]:
    """Consolidated spread (standalone when the company has no consolidated
    accounts) plus the standalone summary of the borrower entity."""
    from bs4 import BeautifulSoup
    out: Dict[str, Any] = {}
    pages = {}
    for kind, path in (("consolidated", f"/company/{slug}/consolidated/"), ("standalone", f"/company/{slug}/")):
        try:
            r = httpx.get(SCREENER_BASE + path, headers=HEADERS, timeout=20, follow_redirects=True)
            r.raise_for_status()
            pages[kind] = (r.text, BeautifulSoup(r.text, "lxml"))
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[ScreenerDeep] {kind} page failed for {slug}: {e}")
    if not pages:
        return {}
    html, soup = pages.get("consolidated") or pages["standalone"]
    basis = page_basis(html) if "consolidated" in pages else "Standalone"
    m = re.search(r'data-company-id="(\d+)"', html)
    company_id = m.group(1) if m else ""
    sched = fetch_schedules(company_id, consolidated=(basis == "Consolidated")) if company_id else {}
    out = build_spread(soup, sched, basis)
    if not out:
        return {}
    out["company_id"] = company_id
    out["url"] = f"{SCREENER_BASE}/company/{slug}/" + ("consolidated/" if basis == "Consolidated" else "")
    if company_id:
        out["segments"] = segment_names(company_id)
    if basis == "Consolidated" and "standalone" in pages:
        out["standalone"] = standalone_summary(pages["standalone"][1])
    return out
