"""
Public data fetcher for listed Indian companies.
Scrapes Screener.in for 3-year financials (P&L, BS, CF, Ratios, Shareholding),
fetches live stock quote via yfinance, extracts company background and credit ratings.
"""
import os
import re
import json
import logging
import tempfile
import httpx
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

SCREENER_BASE = "https://www.screener.in"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}
N_YEARS = 3   # Number of annual years to extract for comparison tables


# ── Stock quote via yfinance ──────────────────────────────────────────────────

def fetch_stock_quote(symbol: str) -> dict:
    """Fetch live stock data for an NSE/BSE symbol."""
    try:
        import yfinance as yf
        for suffix in [".NS", ".BO"]:
            ticker = yf.Ticker(symbol.upper() + suffix)
            info = ticker.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price:
                return {
                    "symbol": symbol.upper() + suffix,
                    "price": price,
                    "change_pct": round(
                        ((price - info.get("previousClose", price)) / info.get("previousClose", price) * 100), 2
                    ) if info.get("previousClose") else 0,
                    "market_cap_cr": round((info.get("marketCap", 0) or 0) / 1e7, 2),
                    "week_52_high": info.get("fiftyTwoWeekHigh"),
                    "week_52_low": info.get("fiftyTwoWeekLow"),
                    "pe_ratio": info.get("trailingPE"),
                    "book_value": info.get("bookValue"),
                    "exchange": "NSE" if suffix == ".NS" else "BSE",
                }
        return {}
    except Exception as e:
        logger.warning(f"Stock quote failed for {symbol}: {e}")
        return {}


# ── Screener.in scraping ──────────────────────────────────────────────────────

def _screener_search(query: str) -> Optional[str]:
    """Return the Screener.in company slug for a symbol/name query."""
    clean = re.sub(r'[^A-Za-z0-9]', '', query).upper()
    for slug in [clean, query.upper().replace(' ', '-')]:
        try:
            resp = httpx.get(
                f"{SCREENER_BASE}/company/{slug}/",
                headers=HEADERS, timeout=8, follow_redirects=True
            )
            if resp.status_code == 200 and "screener.in" in str(resp.url):
                return slug
        except Exception:
            pass
    try:
        from ddgs import DDGS
        with DDGS() as d:
            results = list(d.text(f"site:screener.in/company {query}", max_results=3))
        for r in results:
            m = re.search(r'screener\.in/company/([A-Z0-9&-]+)/', r.get("href", ""), re.IGNORECASE)
            if m:
                return m.group(1).upper()
    except Exception:
        pass
    return None


def _parse_number(val: str) -> Optional[float]:
    """Parse '1,234.56' → 1234.56, '-' → None."""
    if not val or val.strip() in ('-', '', 'N/A', '--'):
        return None
    cleaned = re.sub(r'[,\s%]', '', val.strip())
    try:
        return float(cleaned)
    except ValueError:
        return None


def _extract_table_section(soup, section_id: str) -> Dict[str, Dict[str, str]]:
    """Extract a financial table section from Screener HTML into {row_name: {col: value}}."""
    try:
        section = soup.find("section", id=section_id)
        if not section:
            return {}
        table = section.find("table")
        if not table:
            return {}
        rows = table.find_all("tr")
        if len(rows) < 2:
            return {}
        headers = [th.get_text(strip=True) for th in rows[0].find_all("th")]
        data = {}
        for row in rows[1:]:
            cells = row.find_all("td")
            if not cells:
                continue
            key = cells[0].get_text(strip=True).rstrip("+").strip()
            vals = [c.get_text(strip=True) for c in cells[1:]]
            if key:
                data[key] = dict(zip(headers[1:], vals))
        return data
    except Exception as e:
        logger.debug(f"Table extraction failed for {section_id}: {e}")
        return {}


def _annual_keys(row_data: Dict[str, str], n: int = N_YEARS) -> List[str]:
    """Return last N annual year keys (Mar YYYY) sorted ascending."""
    keys = sorted([k for k in row_data if re.match(r'Mar \d{4}$', k)])
    return keys[-n:] if keys else []


def _year_values(row_data: Dict[str, str], keys: List[str]) -> List[Optional[float]]:
    """Return parsed values for each key."""
    return [_parse_number(row_data.get(k, '')) for k in keys]


def _latest(row_data: Dict[str, str]) -> Optional[float]:
    keys = _annual_keys(row_data, 1)
    return _parse_number(row_data[keys[0]]) if keys else None


def fetch_screener_page(symbol: str, company_name: str = ""):
    """Fetch Screener.in page. Returns (slug, BeautifulSoup)."""
    from bs4 import BeautifulSoup
    slug = _screener_search(symbol) or (company_name and _screener_search(company_name))
    if not slug:
        return None, None
    url = f"{SCREENER_BASE}/company/{slug}/"
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        return slug, BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning(f"Screener page fetch failed for {slug}: {e}")
        return slug, None


def fetch_screener_financials(symbol: str, company_name: str = "") -> dict:
    """
    Fetch 3-year financial statements from Screener.in.
    Returns rich structured data: P&L, BS, CF (3 years each), ratios, shareholding,
    company background, key points, management, credit ratings, industry context.
    """
    slug, soup = fetch_screener_page(symbol, company_name)
    if not soup:
        return {}

    url = f"{SCREENER_BASE}/company/{slug}/"
    logger.info(f"[Screener] Extracting 3-year financials from {url}")

    # ── Extract all financial tables ──────────────────────────────────────
    pl_tbl  = _extract_table_section(soup, "profit-loss")
    bs_tbl  = _extract_table_section(soup, "balance-sheet")
    cf_tbl  = _extract_table_section(soup, "cash-flow")
    rat_tbl = _extract_table_section(soup, "ratios")
    sh_tbl  = _extract_table_section(soup, "shareholding")

    # ── Year labels (last 3 annual years) ─────────────────────────────────
    rev_row   = pl_tbl.get("Sales", pl_tbl.get("Revenue", {}))
    year_keys = _annual_keys(rev_row, N_YEARS)           # e.g. ["Mar 2023", "Mar 2024", "Mar 2025"]
    y1, y2, y3 = (year_keys[0] if len(year_keys) > 0 else "FY-3",
                  year_keys[1] if len(year_keys) > 1 else "FY-2",
                  year_keys[2] if len(year_keys) > 2 else "FY-1")
    current_year  = y3
    previous_year = y2

    def _ys(row_key: str) -> List[Optional[float]]:
        return _year_values(pl_tbl.get(row_key, {}), year_keys)

    def _ys_bs(row_key: str) -> List[Optional[float]]:
        return _year_values(bs_tbl.get(row_key, {}), year_keys)

    def _ys_cf(row_key: str) -> List[Optional[float]]:
        return _year_values(cf_tbl.get(row_key, {}), year_keys)

    def _ys_rat(row_key: str) -> List[Optional[float]]:
        return _year_values(rat_tbl.get(row_key, {}), year_keys)

    # ── P&L multi-year ─────────────────────────────────────────────────────
    revenue      = _ys("Sales")
    expenses     = _ys("Expenses")
    ebitda       = _ys("Operating Profit")
    opm_pct      = _ys("OPM %")
    other_income = _ys("Other Income")
    interest     = _ys("Interest")
    depreciation = _ys("Depreciation")
    pbt          = _ys("Profit before tax")
    pat          = _ys("Net Profit")
    eps          = _ys("EPS in Rs")

    # ── Balance sheet multi-year ───────────────────────────────────────────
    equity_cap   = _ys_bs("Equity Capital")
    reserves     = _ys_bs("Reserves")
    borrowings   = _ys_bs("Borrowings")
    other_liab   = _ys_bs("Other Liabilities")
    total_liab   = _ys_bs("Total Liabilities")
    fixed_assets = _ys_bs("Fixed Assets")
    cwip         = _ys_bs("CWIP")
    investments  = _ys_bs("Investments")
    other_assets = _ys_bs("Other Assets")
    total_assets = _ys_bs("Total Assets")

    def _sum(a, b):
        """Sum two optional-float lists element-wise."""
        return [((_a or 0) + (_b or 0)) if (_a is not None or _b is not None) else None
                for _a, _b in zip(a, b)]

    total_equity = _sum(equity_cap, reserves)

    # Current year (index -1) values for summary fields
    def last(lst): return lst[-1] if lst else None

    # ── Cash flow multi-year ───────────────────────────────────────────────
    cfo  = _ys_cf("Cash from Operating Activity")
    cfi  = _ys_cf("Cash from Investing Activity")
    cff  = _ys_cf("Cash from Financing Activity")
    fcf  = _ys_cf("Free Cash Flow")

    # ── Ratios multi-year ──────────────────────────────────────────────────
    roce_series     = _ys_rat("ROCE %")
    debtor_days     = _latest(rat_tbl.get("Debtor Days", {}))
    inventory_days  = _latest(rat_tbl.get("Inventory Days", {}))
    payable_days    = _latest(rat_tbl.get("Days Payable", {}))
    wc_days         = _latest(rat_tbl.get("Working Capital Days", {}))
    cfo_op_ratio    = [_parse_number(rat_tbl.get("CFO/OP", {}).get(k)) for k in year_keys]

    # Compounded growth rates
    rev_cagr_3y = None
    if revenue and len(revenue) >= 2 and revenue[0] and revenue[-1] and revenue[0] > 0:
        n_years = len(revenue) - 1
        rev_cagr_3y = round(((revenue[-1] / revenue[0]) ** (1 / n_years) - 1) * 100, 1)

    pat_cagr_3y = None
    if pat and len(pat) >= 2 and pat[0] and pat[-1] and pat[0] > 0 and pat[-1] > 0 and pat[0] > 0:
        n_years = len(pat) - 1
        try:
            pat_cagr_3y = round(((pat[-1] / pat[0]) ** (1 / n_years) - 1) * 100, 1)
        except Exception:
            pass

    # ── Top-level key metrics ──────────────────────────────────────────────
    top_metrics = {}
    top_ratios = soup.find(id="top-ratios")
    if top_ratios:
        text = top_ratios.get_text(separator=" ", strip=True)
        patterns = [
            (r'Market Cap.*?₹\s*([\d,]+(?:\.\d+)?)', "market_cap_cr"),
            (r'Stock P/E\s+([\d.]+)',                 "pe_ratio"),
            (r'Book Value.*?₹\s*([\d,]+(?:\.\d+)?)', "book_value"),
            (r'ROCE\s+([\d.]+)',                      "roce"),
            (r'ROE\s+([\d.]+)',                       "roe"),
            (r'Dividend Yield\s+([\d.]+)',             "dividend_yield"),
        ]
        for pat, key in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                top_metrics[key] = float(m.group(1).replace(",", ""))
        # Current price
        for li in top_ratios.find_all("li"):
            t = li.get_text(separator=" ", strip=True)
            m = re.search(r'Current Price.*?₹\s*([\d,]+(?:\.\d+)?)', t)
            if m: top_metrics["current_price"] = float(m.group(1).replace(",", ""))
            m = re.search(r'High / Low.*?₹\s*([\d,]+(?:\.\d+)?)\s*/\s*([\d,]+(?:\.\d+)?)', t)
            if m:
                top_metrics["week_52_high"] = float(m.group(1).replace(",", ""))
                top_metrics["week_52_low"]  = float(m.group(2).replace(",", ""))

    # ── Company background ─────────────────────────────────────────────────
    about_text = ""
    key_points = []

    # Try multiple selectors for the about/description
    for sel in [{"id": "company-info"}, {"class": "about"}, {"id": "about"}]:
        node = soup.find(**{"attrs": sel} if "class" in sel else sel)
        if node:
            about_text = node.get_text(separator=" ", strip=True)[:800]
            break
    if not about_text:
        m = re.search(r'(Incorporated in[^.]+\.[^.]+\.)', soup.get_text(separator=" "), re.IGNORECASE)
        if m:
            about_text = m.group(1).strip()

    # Key Points section
    kp_section = soup.find(id="key-points") or soup.find(class_="key-points")
    if kp_section:
        for li in kp_section.find_all("li")[:8]:
            t = li.get_text(strip=True)
            if t and len(t) > 10:
                key_points.append(t)
    # Also check Pros/Cons
    pros_section = soup.find(class_="pros") or soup.find(id="pros")
    if pros_section:
        for li in pros_section.find_all("li")[:4]:
            t = li.get_text(strip=True)
            if t: key_points.append("✓ " + t)
    cons_section = soup.find(class_="cons") or soup.find(id="cons")
    if cons_section:
        for li in cons_section.find_all("li")[:4]:
            t = li.get_text(strip=True)
            if t: key_points.append("✗ " + t)

    # ── Shareholding ───────────────────────────────────────────────────────
    promoter_holding = None
    promoter_trend = []
    if "Promoters" in sh_tbl:
        vals = sh_tbl["Promoters"]
        # Latest quarterly value
        q_keys = sorted([k for k in vals if not re.match(r'Mar \d{4}$', k)])
        if q_keys:
            promoter_holding = _parse_number(vals[q_keys[-1]])
        else:
            a_keys = sorted(vals.keys())
            if a_keys:
                promoter_holding = _parse_number(vals[a_keys[-1]])
        # Trend (last 4 quarters or years)
        all_keys = sorted(vals.keys())[-4:]
        promoter_trend = [{"period": k, "pct": _parse_number(vals[k])} for k in all_keys]

    fiis_holding = None
    if "FIIs" in sh_tbl:
        vals = sh_tbl["FIIs"]
        latest_key = sorted(vals.keys())[-1] if vals else None
        if latest_key:
            fiis_holding = _parse_number(vals[latest_key])

    # ── Credit ratings ─────────────────────────────────────────────────────
    credit_ratings = []
    docs_section = soup.find("section", id="documents")
    if docs_section:
        rating_items = docs_section.find_all(
            lambda tag: tag.name and "rating" in tag.get_text(separator=" ", strip=True).lower()
        )
        for item in rating_items[:5]:
            text = item.get_text(separator=" | ", strip=True)
            if len(text) > 10:
                credit_ratings.append(text[:150])

    # Annual report links
    annual_report_links = []
    if docs_section:
        for a in docs_section.find_all("a", href=True):
            text = a.get_text(strip=True)
            href = a["href"]
            if re.search(r'financial year|annual report', text, re.IGNORECASE) or "bse" in href.lower():
                annual_report_links.append({"text": text, "url": href})

    # ── Concall highlights ─────────────────────────────────────────────────
    recent_announcements = []
    for tag in soup.find_all(string=re.compile(r'Q\d+FY\d+|Revenue Rs|PAT Rs|EBITDA', re.IGNORECASE))[:3]:
        t = tag.strip()[:200]
        if len(t) > 20:
            recent_announcements.append(t)

    # ── Peer comparison ────────────────────────────────────────────────────
    peers = []
    peers_section = soup.find("section", id="peers")
    if peers_section:
        table = peers_section.find("table")
        if table:
            rows = table.find_all("tr")
            if rows:
                hdrs = [th.get_text(strip=True) for th in rows[0].find_all("th")]
                for row in rows[1:6]:
                    cells = [td.get_text(strip=True) for td in row.find_all("td")]
                    if cells and len(cells) >= 3:
                        peer = {hdrs[i]: cells[i] for i in range(min(len(hdrs), len(cells)))}
                        peers.append(peer)

    # ── Build finalized schema ─────────────────────────────────────────────
    logger.info(
        f"[Screener] {symbol} | Years: {year_keys} | "
        f"Revenue: {revenue} | PAT: {pat} | Debt: {borrowings}"
    )

    return {
        "source": "screener",
        "screener_url": url,

        # ── Company profile ────────────────────────────────────────────────
        "company_info": {
            "name": company_name or symbol,
            "symbol": symbol.upper(),
            "financial_year": current_year,
            "previous_year": previous_year,
            "about": about_text,
            "key_points": key_points[:10],
            "recent_announcements": recent_announcements,
            "promoter_holding": promoter_holding,
            "promoter_trend": promoter_trend,
            "fiis_holding": fiis_holding,
            "market_cap_cr": top_metrics.get("market_cap_cr"),
            "current_price": top_metrics.get("current_price"),
            "week_52_high": top_metrics.get("week_52_high"),
            "week_52_low": top_metrics.get("week_52_low"),
            "book_value": top_metrics.get("book_value"),
            "pe_ratio": top_metrics.get("pe_ratio"),
            "dividend_yield": top_metrics.get("dividend_yield"),
            "credit_ratings": credit_ratings[:4],
            "annual_report_links": annual_report_links[:5],
        },

        # ── 3-year P&L (arrays aligned to year_keys) ──────────────────────
        "profit_loss": {
            "years": year_keys,
            "revenue":      revenue,
            "expenses":     expenses,
            "ebitda":       ebitda,
            "opm_pct":      opm_pct,
            "other_income": other_income,
            "interest":     interest,
            "depreciation": depreciation,
            "pbt":          pbt,
            "pat":          pat,
            "eps":          eps,
            "rev_cagr_3y":  rev_cagr_3y,
            "pat_cagr_3y":  pat_cagr_3y,
            # Backward-compat scalar aliases
            "revenue_from_operations": {"current": last(revenue), "previous": revenue[-2] if len(revenue) > 1 else None},
            "ebitda":                  {"current": last(ebitda),  "previous": ebitda[-2]  if len(ebitda)  > 1 else None},
            "profit_before_tax":       {"current": last(pbt),     "previous": pbt[-2]     if len(pbt)     > 1 else None},
            "profit_after_tax":        {"current": last(pat),     "previous": pat[-2]     if len(pat)     > 1 else None},
            "finance_costs":           {"current": last(interest),"previous": interest[-2] if len(interest)> 1 else None},
            "depreciation_amortization": {"current": last(depreciation), "previous": None},
        },

        # ── 3-year Balance Sheet ───────────────────────────────────────────
        "balance_sheet": {
            "years": year_keys,
            "equity_capital":  equity_cap,
            "reserves":        reserves,
            "total_equity":    total_equity,
            "borrowings":      borrowings,
            "other_liabilities": other_liab,
            "total_liabilities": total_liab,
            "fixed_assets":    fixed_assets,
            "cwip":            cwip,
            "investments":     investments,
            "other_assets":    other_assets,
            "total_assets":    total_assets,
            # Nested schema for memo builder / ratios
            "current_year": current_year,
            "assets": {
                "total_assets": last(total_assets),
                "current_assets": {
                    "total_current_assets": (last(total_assets) or 0) - (last(fixed_assets) or 0) - (last(cwip) or 0) - (last(investments) or 0),
                    "inventories": {"total": None},
                    "trade_receivables": {"total": None},
                    "cash_and_bank": None,
                },
                "non_current_assets": {
                    "property_plant_equipment": last(fixed_assets),
                    "capital_wip": last(cwip),
                    "investments": last(investments),
                    "total_non_current_assets": (last(fixed_assets) or 0) + (last(cwip) or 0) + (last(investments) or 0),
                },
            },
            "liabilities": {
                "current_liabilities": {
                    "short_term_borrowings": None,
                    "trade_payables": {"total": None},
                    "total_current_liabilities": None,
                },
                "non_current_liabilities": {
                    "long_term_borrowings": last(borrowings),
                    "total_non_current_liabilities": last(borrowings),
                },
                "total_liabilities": last(total_liab),
            },
            "equity": {
                "share_capital": last(equity_cap),
                "reserves_surplus": last(reserves),
                "total_equity": last(total_equity),
            },
        },

        # ── 3-year Cash Flow ───────────────────────────────────────────────
        "cash_flow": {
            "years": year_keys,
            "operating":  cfo,
            "investing":  cfi,
            "financing":  cff,
            "free_cash_flow": fcf,
            "cfo_op_ratio": cfo_op_ratio,
            # Scalar aliases
            "operating_activities": last(cfo),
            "investing_activities": last(cfi),
            "financing_activities": last(cff),
            "net_change_in_cash": sum(x or 0 for x in [last(cfo), last(cfi), last(cff)]),
        },

        # ── Ratios ─────────────────────────────────────────────────────────
        "key_ratios_from_screener": {
            "roce_pct":         last(roce_series),
            "roce_series":      [{"year": y, "roce": v} for y, v in zip(year_keys, roce_series)],
            "roe_pct":          top_metrics.get("roe"),
            "debtor_days":      debtor_days,
            "inventory_days":   inventory_days,
            "payable_days":     payable_days,
            "working_capital_days": wc_days,
            "total_debt":       last(borrowings),
            "total_equity":     last(total_equity),
            "debt_equity_ratio": round(last(borrowings) / last(total_equity), 2)
                                  if last(total_equity) and last(borrowings) else None,
            "interest_coverage": round((last(ebitda) or 0) / last(interest), 2)
                                  if last(interest) and last(interest) > 0 and last(ebitda) else None,
        },

        # ── Historical series (5 years for trend chart) ────────────────────
        "historical_trends": {
            "revenue":  [{"year": k, "value": _parse_number(rev_row.get(k))}
                         for k in sorted([x for x in rev_row if re.match(r'Mar \d{4}$', x)])[-5:]],
            "pat":      [{"year": k, "value": _parse_number(pl_tbl.get("Net Profit", {}).get(k))}
                         for k in sorted([x for x in pl_tbl.get("Net Profit", {}) if re.match(r'Mar \d{4}$', x)])[-5:]],
            "debt":     [{"year": k, "value": _parse_number(bs_tbl.get("Borrowings", {}).get(k))}
                         for k in sorted([x for x in bs_tbl.get("Borrowings", {}) if re.match(r'Mar \d{4}$', x)])[-5:]],
            "roce":     [{"year": k, "value": _parse_number(rat_tbl.get("ROCE %", {}).get(k))}
                         for k in sorted([x for x in rat_tbl.get("ROCE %", {}) if re.match(r'Mar \d{4}$', x)])[-5:]],
        },

        # ── Shareholding ───────────────────────────────────────────────────
        "shareholding": {
            "promoter_holding_pct": promoter_holding,
            "promoter_trend": promoter_trend,
            "fiis_holding_pct": fiis_holding,
        },

        "peers": peers,
    }


def fetch_screener_data(symbol: str, company_name: str = "") -> dict:
    """Lightweight backward-compatible wrapper."""
    slug, soup = fetch_screener_page(symbol, company_name)
    if not soup:
        return {}
    url = f"{SCREENER_BASE}/company/{slug}/"
    data = {"screener_url": url, "slug": slug}
    sh = _extract_table_section(soup, "shareholding")
    if "Promoters" in sh:
        vals = sh["Promoters"]
        if vals:
            data["promoter_holding"] = _parse_number(list(vals.values())[-1])
    top = soup.find(id="top-ratios")
    if top:
        text = top.get_text(separator=" ", strip=True)
        for pat, key in [(r'Market Cap.*?₹\s*([\d,]+)', "market_cap_cr"),
                         (r'Stock P/E\s+([\d.]+)', "pe_ratio"),
                         (r'ROCE\s+([\d.]+)', "roce")]:
            m = re.search(pat, text, re.IGNORECASE)
            if m: data[key] = float(m.group(1).replace(",", ""))
    peers = []
    peers_section = soup.find("section", id="peers")
    if peers_section:
        table = peers_section.find("table")
        if table:
            rows = table.find_all("tr")
            if rows:
                hdrs = [th.get_text(strip=True) for th in rows[0].find_all("th")]
                for row in rows[1:6]:
                    cells = [td.get_text(strip=True) for td in row.find_all("td")]
                    if cells and len(cells) >= 3:
                        peers.append({hdrs[i]: cells[i] for i in range(min(len(hdrs), len(cells)))})
    data["peers"] = peers
    return data


# ── BSE annual report download ────────────────────────────────────────────────

def _get_bse_code(symbol: str) -> Optional[str]:
    try:
        resp = httpx.get(
            "https://api.bseindia.com/BseIndiaAPI/api/listofscripData/w",
            params={"Group": "", "Scripcode": "", "industry": "", "segment": "Equity", "status": "Active"},
            headers={**HEADERS, "Referer": "https://www.bseindia.com/"},
            timeout=10,
        )
        resp.raise_for_status()
        for item in resp.json().get("Table", []):
            if symbol.upper() in item.get("short_name", "").upper() or symbol.upper() in item.get("Issuer_Name", "").upper():
                return str(item.get("SCRIP_CD", ""))
    except Exception as e:
        logger.debug(f"BSE code lookup failed: {e}")
    return None


def fetch_bse_annual_report(symbol: str, company_name: str = "") -> Optional[str]:
    bse_code = _get_bse_code(symbol)
    if not bse_code:
        return None
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
        if not reports:
            return None
        latest = sorted(reports, key=lambda x: x.get("NEWDTE", ""), reverse=True)[0]
        pdf_url = latest.get("FILINGURL") or latest.get("PDFURL") or latest.get("pdf_url")
        if not pdf_url:
            return None
        if not pdf_url.startswith("http"):
            pdf_url = "https://www.bseindia.com" + pdf_url
        pdf_resp = httpx.get(pdf_url, headers=HEADERS, timeout=60, follow_redirects=True)
        pdf_resp.raise_for_status()
        if len(pdf_resp.content) < 10000:
            return None
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        tmp.write(pdf_resp.content)
        tmp.close()
        logger.info(f"Downloaded annual report: {tmp.name} ({len(pdf_resp.content)//1024} KB)")
        return tmp.name
    except Exception as e:
        logger.warning(f"BSE annual report download failed: {e}")
        return None


# ── Main entry point ──────────────────────────────────────────────────────────

def fetch_all_public_data(symbol: str, company_name: str = "", industry: str = "") -> dict:
    logger.info(f"[PublicData] Fetching data for symbol={symbol} company={company_name}")
    result = {
        "symbol": symbol, "is_listed": False,
        "stock": {}, "screener": {}, "screener_financials": {},
        "peers": [], "annual_report_path": None, "error": None,
    }
    stock = fetch_stock_quote(symbol)
    if stock and stock.get("price"):
        result["stock"] = stock
        result["is_listed"] = True

    screener_fin = fetch_screener_financials(symbol, company_name)
    if screener_fin:
        peers = screener_fin.pop("peers", [])
        result["screener"] = {
            "screener_url": screener_fin.get("screener_url"),
            "promoter_holding": screener_fin.get("company_info", {}).get("promoter_holding"),
            "market_cap_cr": screener_fin.get("company_info", {}).get("market_cap_cr"),
            "pe_ratio": screener_fin.get("company_info", {}).get("pe_ratio"),
            "roce": screener_fin.get("key_ratios_from_screener", {}).get("roce_pct"),
            "roe": screener_fin.get("key_ratios_from_screener", {}).get("roe_pct"),
        }
        result["screener_financials"] = screener_fin
        result["peers"] = peers
        result["is_listed"] = True

    ar_path = fetch_bse_annual_report(symbol, company_name)
    if ar_path:
        result["annual_report_path"] = ar_path
        result["is_listed"] = True

    return result
