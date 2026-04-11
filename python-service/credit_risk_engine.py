"""
Credit Risk Pre-Computation Engine.

All deterministic computation happens here BEFORE the LLM sees any data.
Implements Sections 1-3 of the Credit Risk Analyst framework:
  1. Input Validation (strict gate)
  2. Structured Data Extraction (per-year arrays)
  3. Financial Metric Computation (margins, ratios, flags)

The LLM receives only the pre-computed CreditRiskContext — it never
touches raw numbers or does arithmetic.
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _n(val, default=None) -> Optional[float]:
    """Safely extract a numeric value. Returns None (not 0) if missing."""
    if val is None or val == "" or val == "N/A":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val.replace(",", ""))
        except ValueError:
            return None
    if isinstance(val, dict):
        for k in ("total", "current", "value"):
            if k in val and val[k] is not None:
                return _n(val[k])
    return None


def _pct(num: Optional[float], den: Optional[float]) -> Optional[float]:
    """Safe percentage: (num / den) * 100. Returns None if impossible."""
    if num is None or den is None or den == 0:
        return None
    return round((num / den) * 100, 2)


def _ratio(num: Optional[float], den: Optional[float]) -> Optional[float]:
    """Safe ratio: num / den. Returns None if impossible."""
    if num is None or den is None or den == 0:
        return None
    return round(num / den, 2)


def _yoy_pct(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    """Year-over-year % change."""
    if current is None or previous is None or previous == 0:
        return None
    return round(((current - previous) / abs(previous)) * 100, 1)


def _cagr(start: Optional[float], end: Optional[float], years: int) -> Optional[float]:
    """Compound annual growth rate."""
    if start is None or end is None or start <= 0 or end <= 0 or years < 1:
        return None
    return round(((end / start) ** (1 / years) - 1) * 100, 1)


def _fmt(val: Optional[float], suffix: str = "", prefix: str = "") -> str:
    """Format a value for display. Returns 'null — cannot be computed' if None."""
    if val is None:
        return "null — cannot be computed due to missing data"
    return f"{prefix}{val:,.2f}{suffix}"


def _arrow(val: Optional[float]) -> str:
    """Directional arrow for a change value."""
    if val is None:
        return ""
    return "▲" if val >= 0 else "▼"


# ── Section 1: Input Validation ────────────────────────────────────────────────

def validate_inputs(financials: Dict, research_brief: str = "") -> Dict[str, Any]:
    """
    STRICT GATE — checks data sufficiency before any analysis.
    Returns validation result with confidence_level.
    """
    is_screener = financials.get("source") == "screener"
    validation = {
        "sufficient": True,
        "warnings": [],
        "confidence_level": "HIGH",
        "years_available": 0,
        "has_qualitative": False,
        "has_cash_flow": False,
        "data_recency": "current",
    }

    # Count available years
    if is_screener:
        pl = financials.get("profit_loss", {}) or {}
        years = pl.get("years", [])
        revenue = pl.get("revenue", [])
        valid_years = sum(1 for r in revenue if r is not None) if revenue else 0
        validation["years_available"] = valid_years

        # Check recency: parse last year label
        if years:
            last_year = years[-1] if years else ""
            try:
                import re
                match = re.search(r'(\d{4})', last_year)
                if match:
                    yr = int(match.group(1))
                    months_old = (datetime.now().year - yr) * 12 + (datetime.now().month - 3)
                    if months_old > 18:
                        validation["warnings"].append(
                            f"OUTDATED FINANCIAL DATA: Latest year is {last_year} ({months_old} months old)"
                        )
                        validation["data_recency"] = "stale"
            except Exception:
                pass
    else:
        # PDF extraction — typically 1-2 years
        prev = financials.get("previous_year_data", {}) or {}
        has_prev = any(v and v != 0 for v in prev.values() if isinstance(v, (int, float)))
        validation["years_available"] = 2 if has_prev else 1

    # Gate: minimum 3 years for Screener, 1 for PDF (relaxed for PDF)
    if is_screener and validation["years_available"] < 3:
        validation["warnings"].append(
            f"Insufficient financial history: only {validation['years_available']} year(s) available (minimum 3 required)"
        )
        # Don't hard-stop — downgrade confidence instead
        validation["confidence_level"] = "LOW"

    if not is_screener and validation["years_available"] < 1:
        validation["sufficient"] = False
        validation["confidence_level"] = "LOW"

    # Qualitative data check
    ci = financials.get("company_info", {}) or {}
    has_about = bool(ci.get("about"))
    has_key_points = bool(ci.get("key_points"))
    has_ratings = bool(ci.get("credit_ratings"))
    has_research = bool(research_brief and len(research_brief) > 100)

    validation["has_qualitative"] = any([has_about, has_key_points, has_ratings, has_research])
    if not validation["has_qualitative"]:
        validation["warnings"].append(
            "No qualitative documents available (annual report, credit rating, investor presentation). Confidence marked LOW."
        )
        validation["confidence_level"] = "LOW"

    # Cash flow check
    cf = financials.get("cash_flow", {}) or {}
    if is_screener:
        cfo = cf.get("operating", [])
        validation["has_cash_flow"] = bool(cfo and any(v is not None for v in cfo))
    else:
        oa = cf.get("operating_activities", {}) or {}
        validation["has_cash_flow"] = bool(_n(oa.get("net_cash_from_operating")))

    if not validation["has_cash_flow"]:
        validation["warnings"].append("Cash flow data unavailable — liquidity analysis limited.")

    # Downgrade confidence if only partial data
    if validation["confidence_level"] == "HIGH":
        issues = len(validation["warnings"])
        if issues >= 2:
            validation["confidence_level"] = "MEDIUM"
        elif issues >= 3:
            validation["confidence_level"] = "LOW"

    return validation


# ── Section 2: Structured Data Extraction (per-year) ──────────────────────────

def extract_yearly_data(financials: Dict) -> List[Dict[str, Any]]:
    """
    Extract structured financial data for EACH available year.
    Missing values are null (not zero). This is critical for honest analysis.
    """
    is_screener = financials.get("source") == "screener"

    if is_screener:
        return _extract_screener_years(financials)
    else:
        return _extract_pdf_years(financials)


def _extract_screener_years(fin: Dict) -> List[Dict]:
    pl = fin.get("profit_loss", {}) or {}
    bs = fin.get("balance_sheet", {}) or {}
    cf = fin.get("cash_flow", {}) or {}

    years = pl.get("years", [])
    n = len(years)

    def _arr(d, key):
        v = d.get(key)
        return v if isinstance(v, list) else [None] * n

    revenue = _arr(pl, "revenue")
    ebitda = _arr(pl, "ebitda")
    interest = _arr(pl, "interest")
    pat = _arr(pl, "pat")
    opm_pct = _arr(pl, "opm_pct")
    depreciation = _arr(pl, "depreciation")

    borrowings = _arr(bs, "borrowings")
    total_equity = _arr(bs, "total_equity")
    total_assets = _arr(bs, "total_assets")

    cfo = _arr(cf, "operating")
    fcf = _arr(cf, "free_cash_flow")

    yearly = []
    for i in range(n):
        yearly.append({
            "year": years[i] if i < len(years) else f"Year {i+1}",
            "revenue": _n(revenue[i]) if i < len(revenue) else None,
            "ebitda": _n(ebitda[i]) if i < len(ebitda) else None,
            "pat": _n(pat[i]) if i < len(pat) else None,
            "total_debt": _n(borrowings[i]) if i < len(borrowings) else None,
            "net_worth": _n(total_equity[i]) if i < len(total_equity) else None,
            "interest_expense": _n(interest[i]) if i < len(interest) else None,
            "cfo": _n(cfo[i]) if i < len(cfo) else None,
            "fcf": _n(fcf[i]) if i < len(fcf) else None,
            "total_assets": _n(total_assets[i]) if i < len(total_assets) else None,
            "opm_pct": _n(opm_pct[i]) if i < len(opm_pct) else None,
            "depreciation": _n(depreciation[i]) if i < len(depreciation) else None,
        })

    return yearly


def _extract_pdf_years(fin: Dict) -> List[Dict]:
    pl = fin.get("profit_loss", {}) or {}
    bs = fin.get("balance_sheet", {}) or {}
    cf = fin.get("cash_flow", {}) or {}
    prev = fin.get("previous_year_data", {}) or {}
    eq = bs.get("equity", {}) or {}
    liab = bs.get("liabilities", {}) or {}
    cl = liab.get("current_liabilities", {}) or {}
    ncl = liab.get("non_current_liabilities", {}) or {}
    rev = pl.get("revenue", {}) or {}
    pm = pl.get("profit_metrics", {}) or {}
    exp = pl.get("expenses", {}) or {}
    oa = cf.get("operating_activities", {}) or {}

    st_debt = _n(cl.get("short_term_borrowings")) or 0
    lt_debt = _n(ncl.get("long_term_borrowings")) or 0

    current_year = {
        "year": fin.get("company_info", {}).get("financial_year", "Current Year"),
        "revenue": _n(rev.get("total_income") or rev.get("revenue_from_operations")),
        "ebitda": _n(pm.get("ebitda")),
        "pat": _n(pm.get("profit_after_tax")),
        "total_debt": st_debt + lt_debt if (st_debt or lt_debt) else None,
        "net_worth": _n(eq.get("total_equity")),
        "interest_expense": _n(exp.get("finance_costs")),
        "cfo": _n(oa.get("net_cash_from_operating")),
        "fcf": None,
        "total_assets": _n(bs.get("total_assets") or bs.get("assets", {}).get("total_assets")),
        "opm_pct": None,
        "depreciation": _n(exp.get("depreciation_amortization")),
    }

    years = [current_year]

    # Previous year if available
    if prev and any(v and v != 0 for v in prev.values() if isinstance(v, (int, float))):
        years.insert(0, {
            "year": "Previous Year",
            "revenue": _n(prev.get("revenue")),
            "ebitda": None,
            "pat": _n(prev.get("net_profit")),
            "total_debt": _n(prev.get("total_debt")),
            "net_worth": _n(prev.get("total_equity")),
            "interest_expense": None,
            "cfo": None,
            "fcf": None,
            "total_assets": _n(prev.get("total_assets")),
            "opm_pct": None,
            "depreciation": None,
        })

    return years


# ── Section 3: Financial Metric Computation ───────────────────────────────────

def compute_metrics(yearly_data: List[Dict]) -> Dict[str, Any]:
    """
    Compute all financial ratios for each year + trends.
    Explicitly returns 'null' for any metric that cannot be computed.
    """
    per_year = []

    for yd in yearly_data:
        rev = yd.get("revenue")
        ebitda = yd.get("ebitda")
        pat = yd.get("pat")
        debt = yd.get("total_debt")
        equity = yd.get("net_worth")
        interest = yd.get("interest_expense")
        cfo = yd.get("cfo")
        depreciation = yd.get("depreciation")
        total_assets = yd.get("total_assets")

        # Derive EBIT if we have EBITDA and depreciation
        ebit = None
        if ebitda is not None and depreciation is not None:
            ebit = ebitda - depreciation

        # DSCR approximation: CFO / (Interest + Debt/5)
        dscr = None
        if cfo is not None and interest is not None:
            principal_est = (debt / 5.0) if debt and debt > 0 else 0
            debt_service = interest + principal_est
            if debt_service > 0:
                dscr = round(cfo / debt_service, 2)

        metrics = {
            "year": yd["year"],
            "ebitda_margin": _pct(ebitda, rev),
            "pat_margin": _pct(pat, rev),
            "debt_equity": _ratio(debt, equity),
            "interest_coverage": _ratio(ebitda, interest),
            "dscr": dscr,
            "roe": _pct(pat, equity),
            "roa": _pct(pat, total_assets),
            "debt_to_assets": _ratio(debt, total_assets),
            "cfo_to_pat": _ratio(cfo, pat) if (cfo is not None and pat is not None and pat != 0) else None,
        }
        per_year.append(metrics)

    # Trend metrics (across years)
    trends = {}
    n = len(yearly_data)
    if n >= 2:
        first = yearly_data[0]
        last = yearly_data[-1]
        prev = yearly_data[-2]

        trends["revenue_yoy"] = _yoy_pct(last.get("revenue"), prev.get("revenue"))
        trends["pat_yoy"] = _yoy_pct(last.get("pat"), prev.get("pat"))
        trends["ebitda_yoy"] = _yoy_pct(last.get("ebitda"), prev.get("ebitda"))
        trends["debt_yoy"] = _yoy_pct(last.get("total_debt"), prev.get("total_debt"))

    if n >= 3:
        trends["revenue_cagr"] = _cagr(
            yearly_data[0].get("revenue"),
            yearly_data[-1].get("revenue"),
            n - 1
        )
        trends["pat_cagr"] = _cagr(
            yearly_data[0].get("pat"),
            yearly_data[-1].get("pat"),
            n - 1
        )

    return {"per_year": per_year, "trends": trends}


# ── Red Flag Detection ────────────────────────────────────────────────────────

def detect_red_flags(yearly_data: List[Dict], metrics: Dict) -> List[Dict[str, str]]:
    """
    Auto-detect risk flags with evidence. Each flag has a description
    and the supporting metric/data reference. No vague statements.
    """
    flags = []
    per_year = metrics.get("per_year", [])
    trends = metrics.get("trends", {})
    n = len(yearly_data)

    if n < 2:
        return flags

    last = yearly_data[-1]
    prev = yearly_data[-2]
    last_m = per_year[-1] if per_year else {}
    prev_m = per_year[-2] if len(per_year) >= 2 else {}

    # Flag 1: Declining CFO despite stable/growing profits
    if (last.get("cfo") is not None and prev.get("cfo") is not None
            and last.get("pat") is not None and prev.get("pat") is not None):
        cfo_declined = last["cfo"] < prev["cfo"]
        pat_stable = last["pat"] >= prev["pat"] * 0.9
        if cfo_declined and pat_stable:
            flags.append({
                "flag": "Declining operating cash flow despite stable profits",
                "evidence": (
                    f"CFO fell from ₹{prev['cfo']:,.0f} Cr to ₹{last['cfo']:,.0f} Cr "
                    f"while PAT was ₹{last['pat']:,.0f} Cr (vs ₹{prev['pat']:,.0f} Cr previously)"
                ),
                "severity": "HIGH",
            })

    # Flag 2: Interest coverage below 1.5
    icr = last_m.get("interest_coverage")
    if icr is not None and icr < 1.5:
        flags.append({
            "flag": "Weak debt servicing ability — interest coverage below 1.5x",
            "evidence": f"Interest Coverage Ratio = {icr:.2f}x (benchmark: >2.5x)",
            "severity": "HIGH",
        })

    # Flag 3: Rising leverage without proportional revenue growth
    rev_yoy = trends.get("revenue_yoy")
    debt_yoy = trends.get("debt_yoy")
    if rev_yoy is not None and debt_yoy is not None:
        if debt_yoy > 15 and (rev_yoy is None or rev_yoy < debt_yoy * 0.5):
            flags.append({
                "flag": "Rising leverage without proportional revenue growth",
                "evidence": (
                    f"Debt grew {debt_yoy:+.1f}% YoY while revenue grew only {rev_yoy:+.1f}% YoY"
                ),
                "severity": "MEDIUM",
            })

    # Flag 4: Debt-to-equity above 2.0
    de = last_m.get("debt_equity")
    if de is not None and de > 2.0:
        flags.append({
            "flag": "High leverage — Debt-to-Equity exceeds 2.0x",
            "evidence": f"Debt/Equity = {de:.2f}x (benchmark: <2.0x)",
            "severity": "MEDIUM",
        })

    # Flag 5: Negative or deteriorating EBITDA margin
    em_curr = last_m.get("ebitda_margin")
    em_prev = prev_m.get("ebitda_margin")
    if em_curr is not None and em_curr < 8:
        flags.append({
            "flag": "Low EBITDA margin indicating pressure on profitability",
            "evidence": f"EBITDA Margin = {em_curr:.1f}% (benchmark: >12%)",
            "severity": "MEDIUM",
        })
    elif em_curr is not None and em_prev is not None and em_curr < em_prev - 3:
        flags.append({
            "flag": "Significant EBITDA margin deterioration",
            "evidence": f"EBITDA Margin declined from {em_prev:.1f}% to {em_curr:.1f}% ({em_curr - em_prev:+.1f}pp)",
            "severity": "MEDIUM",
        })

    # Flag 6: Negative PAT (losses)
    if last.get("pat") is not None and last["pat"] < 0:
        flags.append({
            "flag": "Net losses in the latest financial year",
            "evidence": f"PAT = ₹{last['pat']:,.0f} Cr (negative)",
            "severity": "HIGH",
        })

    # Flag 7: CFO-to-PAT disconnect (profits not backed by cash)
    cfo_pat = last_m.get("cfo_to_pat")
    if cfo_pat is not None and last.get("pat") and last["pat"] > 0 and cfo_pat < 0.5:
        flags.append({
            "flag": "Profits not adequately backed by operating cash flows",
            "evidence": f"CFO/PAT ratio = {cfo_pat:.2f}x (healthy: >0.8x)",
            "severity": "MEDIUM",
        })

    # Flag 8: DSCR below 1.0
    dscr = last_m.get("dscr")
    if dscr is not None and dscr < 1.0:
        flags.append({
            "flag": "DSCR below 1.0 — insufficient cash flow to service debt",
            "evidence": f"DSCR = {dscr:.2f}x (minimum: ≥1.25x)",
            "severity": "HIGH",
        })

    return flags


# ── Mitigating Factors Detection ──────────────────────────────────────────────

def detect_mitigants(yearly_data: List[Dict], metrics: Dict, financials: Dict) -> List[str]:
    """Identify genuine strengths backed by data."""
    mitigants = []
    per_year = metrics.get("per_year", [])
    trends = metrics.get("trends", {})
    n = len(yearly_data)

    if not per_year:
        return mitigants

    last = yearly_data[-1]
    last_m = per_year[-1]

    # Strong profitability
    em = last_m.get("ebitda_margin")
    if em is not None and em > 15:
        mitigants.append(f"Strong EBITDA margin of {em:.1f}% (well above 12% benchmark)")

    # Low leverage
    de = last_m.get("debt_equity")
    if de is not None and de < 1.0:
        mitigants.append(f"Conservative leverage with Debt/Equity of {de:.2f}x")

    # Consistent revenue growth
    cagr = trends.get("revenue_cagr")
    if cagr is not None and cagr > 10:
        mitigants.append(f"Consistent revenue growth with {cagr:+.1f}% CAGR over {n-1} years")

    # Strong cash generation
    if last.get("cfo") is not None and last["cfo"] > 0:
        cfo_pat = last_m.get("cfo_to_pat")
        if cfo_pat is not None and cfo_pat > 1.0:
            mitigants.append(f"Strong cash generation — CFO exceeds PAT (CFO/PAT = {cfo_pat:.1f}x)")

    # Strong ICR
    icr = last_m.get("interest_coverage")
    if icr is not None and icr > 3.0:
        mitigants.append(f"Comfortable interest coverage of {icr:.1f}x (benchmark: >2.5x)")

    # Good DSCR
    dscr = last_m.get("dscr")
    if dscr is not None and dscr > 1.5:
        mitigants.append(f"Healthy DSCR of {dscr:.2f}x indicating adequate debt servicing capacity")

    # Promoter holding (from company_info)
    sh = financials.get("shareholding", {}) or {}
    ph = sh.get("promoter_holding_pct")
    if ph is not None and ph > 50:
        mitigants.append(f"Strong promoter holding at {ph:.1f}%, signaling management commitment")

    return mitigants


# ── Main: Build Full Context ──────────────────────────────────────────────────

def build_context(
    financials: Dict,
    ratios: Dict,
    research_brief: str = "",
    company_name: str = "",
) -> Dict[str, Any]:
    """
    Master function: runs the full pre-computation pipeline.
    Returns a CreditRiskContext dict ready for the LLM prompt.
    """
    # Step 1: Validate
    validation = validate_inputs(financials, research_brief)

    if not validation["sufficient"]:
        return {
            "abort": True,
            "abort_reason": "Insufficient financial history for credit assessment",
            "validation": validation,
        }

    # Step 2: Extract yearly data
    yearly_data = extract_yearly_data(financials)

    # Step 3: Compute metrics
    computed = compute_metrics(yearly_data)

    # Step 4: Detect red flags
    red_flags = detect_red_flags(yearly_data, computed)

    # Step 5: Detect mitigants
    mitigants = detect_mitigants(yearly_data, computed, financials)

    # Step 6: Build the formatted context string for the LLM
    context_text = _format_context_for_llm(
        financials, yearly_data, computed, red_flags, mitigants,
        validation, ratios, research_brief, company_name,
    )

    return {
        "abort": False,
        "validation": validation,
        "yearly_data": yearly_data,
        "computed_metrics": computed,
        "red_flags": red_flags,
        "mitigants": mitigants,
        "context_text": context_text,
    }


def _format_context_for_llm(
    financials, yearly_data, computed, red_flags, mitigants,
    validation, ratios, research_brief, company_name,
) -> str:
    """Format all pre-computed data into a structured text block for the LLM."""
    ci = financials.get("company_info", {}) or {}
    is_screener = financials.get("source") == "screener"
    per_year = computed.get("per_year", [])
    trends = computed.get("trends", {})
    kr = financials.get("key_ratios_from_screener", {}) or {}
    sh = financials.get("shareholding", {}) or {}

    lines = []
    lines.append("=" * 70)
    lines.append("PRE-COMPUTED CREDIT RISK DATA (Python Engine — verified arithmetic)")
    lines.append("=" * 70)

    # Company info
    lines.append(f"\nBORROWER: {company_name or ci.get('name', 'Unknown')}")
    lines.append(f"INDUSTRY: {ci.get('industry') or 'Not specified'}")
    if ci.get("symbol"):
        lines.append(f"SYMBOL: {ci['symbol']} (Listed)")
    if ci.get("about"):
        lines.append(f"ABOUT: {ci['about'][:500]}")

    # Data quality
    lines.append(f"\nDATA QUALITY:")
    lines.append(f"  Years available: {validation['years_available']}")
    lines.append(f"  Confidence Level: {validation['confidence_level']}")
    lines.append(f"  Data recency: {validation['data_recency']}")
    lines.append(f"  Cash flow data: {'Available' if validation['has_cash_flow'] else 'NOT available'}")
    lines.append(f"  Qualitative data: {'Available' if validation['has_qualitative'] else 'NOT available'}")
    for w in validation.get("warnings", []):
        lines.append(f"  ⚠ {w}")

    # Per-year financial data
    lines.append(f"\nFINANCIAL DATA BY YEAR (₹ in Crores):")
    lines.append("-" * 70)
    for i, yd in enumerate(yearly_data):
        lines.append(f"\n  {yd['year']}:")
        lines.append(f"    Revenue:          {_fmt(yd.get('revenue'), ' Cr', '₹')}")
        lines.append(f"    EBITDA:           {_fmt(yd.get('ebitda'), ' Cr', '₹')}")
        lines.append(f"    PAT:              {_fmt(yd.get('pat'), ' Cr', '₹')}")
        lines.append(f"    Total Debt:       {_fmt(yd.get('total_debt'), ' Cr', '₹')}")
        lines.append(f"    Net Worth:        {_fmt(yd.get('net_worth'), ' Cr', '₹')}")
        lines.append(f"    Interest Expense: {_fmt(yd.get('interest_expense'), ' Cr', '₹')}")
        lines.append(f"    CFO:              {_fmt(yd.get('cfo'), ' Cr', '₹')}")

    # Per-year computed ratios
    lines.append(f"\nCOMPUTED RATIOS BY YEAR (Python-verified):")
    lines.append("-" * 70)
    for m in per_year:
        lines.append(f"\n  {m['year']}:")
        lines.append(f"    EBITDA Margin:       {_fmt(m.get('ebitda_margin'), '%')}")
        lines.append(f"    PAT Margin:          {_fmt(m.get('pat_margin'), '%')}")
        lines.append(f"    Debt/Equity:         {_fmt(m.get('debt_equity'), 'x')}")
        lines.append(f"    Interest Coverage:   {_fmt(m.get('interest_coverage'), 'x')}")
        lines.append(f"    DSCR:                {_fmt(m.get('dscr'), 'x')}")
        lines.append(f"    ROE:                 {_fmt(m.get('roe'), '%')}")
        lines.append(f"    CFO/PAT:             {_fmt(m.get('cfo_to_pat'), 'x')}")

    # Trend metrics
    if trends:
        lines.append(f"\nTREND METRICS:")
        lines.append("-" * 70)
        for k, v in trends.items():
            label = k.replace("_", " ").title()
            if v is not None:
                lines.append(f"  {label}: {v:+.1f}%")
            else:
                lines.append(f"  {label}: Cannot be computed — missing data")

    # Screener extra ratios
    if kr:
        lines.append(f"\nADDITIONAL RATIOS (Screener.in):")
        if kr.get("roce_pct"): lines.append(f"  ROCE: {kr['roce_pct']}%")
        if kr.get("roe_pct"): lines.append(f"  ROE: {kr['roe_pct']}%")
        if kr.get("debtor_days"): lines.append(f"  Debtor Days: {kr['debtor_days']}")
        if kr.get("inventory_days"): lines.append(f"  Inventory Days: {kr['inventory_days']}")

    # Shareholding
    if sh.get("promoter_holding_pct"):
        lines.append(f"\nSHAREHOLDING:")
        lines.append(f"  Promoter Holding: {sh['promoter_holding_pct']}%")
        if sh.get("fiis_holding_pct"):
            lines.append(f"  FII Holding: {sh['fiis_holding_pct']}%")

    # Auto-detected red flags
    lines.append(f"\nAUTO-DETECTED RED FLAGS ({len(red_flags)} found):")
    lines.append("-" * 70)
    if red_flags:
        for i, rf in enumerate(red_flags, 1):
            lines.append(f"  {i}. [{rf['severity']}] {rf['flag']}")
            lines.append(f"     Evidence: {rf['evidence']}")
    else:
        lines.append("  No critical red flags detected by automated screening.")

    # Auto-detected mitigants
    lines.append(f"\nAUTO-DETECTED MITIGATING FACTORS ({len(mitigants)} found):")
    lines.append("-" * 70)
    for i, m in enumerate(mitigants, 1):
        lines.append(f"  {i}. {m}")

    # Research brief
    if research_brief:
        lines.append(f"\nEXTERNAL INTELLIGENCE (Web Research):")
        lines.append("=" * 70)
        lines.append(research_brief[:4000])

    lines.append("\n" + "=" * 70)

    return "\n".join(lines)
