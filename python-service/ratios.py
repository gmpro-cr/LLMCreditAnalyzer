"""
Financial ratio computation engine.
All ratios computed from structured extracted data — no LLM involved.
"""
from typing import Dict, Any


def _n(val, default=0.0) -> float:
    """Safely extract a numeric value."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, dict):
        for k in ("total", "total_current_assets", "total_non_current_assets",
                  "total_current_liabilities", "total_equity", "total_assets"):
            if k in val:
                return _n(val[k], default)
    return default


def _div(num, den, default=0.0) -> float:
    if den == 0 or den is None:
        return default
    return num / den


def calculate_ratios(financials: Dict[str, Any]) -> Dict[str, float]:
    try:
        return _compute(financials)
    except Exception as e:
        import logging, traceback
        logging.getLogger(__name__).error(f"Ratio error: {e}\n{traceback.format_exc()}")
        return {}


def _cy(d):
    """Extract current-year value from {current: X, previous: Y} or plain value."""
    if isinstance(d, dict):
        return d.get("current") or d.get("value") or 0
    return d or 0


def _normalize_for_ratios(f: Dict) -> Dict:
    """Normalize Screener financials to the standard schema for ratio calculation."""
    if f.get("source") != "screener":
        return f
    pl_raw = f.get("profit_loss", {}) or {}
    bs_raw = f.get("balance_sheet", {}) or {}
    cf_raw = f.get("cash_flow", {}) or {}
    eq_raw = bs_raw.get("equity", {}) or {}
    assets = bs_raw.get("assets", {}) or {}
    liab   = bs_raw.get("liabilities", {}) or {}
    ca_raw = assets.get("current_assets", {}) or {}
    nca_raw = assets.get("non_current_assets", {}) or {}
    ncl_raw = liab.get("non_current_liabilities", {}) or {}
    cl_raw  = liab.get("current_liabilities", {}) or {}

    rev_cy = _cy(pl_raw.get("revenue_from_operations"))
    return {
        "balance_sheet": {
            "total_assets": assets.get("total_assets"),
            "assets": {
                "total_assets": assets.get("total_assets"),
                "current_assets": {
                    "total_current_assets": ca_raw.get("total_current_assets"),
                    "inventories": ca_raw.get("inventories"),
                    "trade_receivables": ca_raw.get("trade_receivables"),
                    "cash_and_bank": ca_raw.get("cash_and_bank"),
                },
                "non_current_assets": {
                    "property_plant_equipment": nca_raw.get("property_plant_equipment"),
                    "total_non_current_assets": nca_raw.get("total_non_current_assets"),
                },
            },
            "liabilities": {
                "current_liabilities": {
                    "total_current_liabilities": cl_raw.get("total_current_liabilities"),
                    "short_term_borrowings": cl_raw.get("short_term_borrowings"),
                    "trade_payables": cl_raw.get("trade_payables"),
                },
                "non_current_liabilities": {
                    "long_term_borrowings": ncl_raw.get("long_term_borrowings"),
                    "total_non_current_liabilities": ncl_raw.get("total_non_current_liabilities"),
                },
                "total_liabilities": liab.get("total_liabilities"),
            },
            "equity": eq_raw,
        },
        "profit_loss": {
            "revenue": {"total_income": rev_cy, "revenue_from_operations": rev_cy},
            "profit_metrics": {
                "ebitda": _cy(pl_raw.get("ebitda")),
                "profit_before_tax": _cy(pl_raw.get("profit_before_tax")),
                "profit_after_tax": _cy(pl_raw.get("profit_after_tax")),
            },
            "expenses": {
                "finance_costs": _cy(pl_raw.get("finance_costs")),
                "depreciation": _cy(pl_raw.get("depreciation_amortization")),
            },
        },
        "cash_flow": {
            "operating_activities": {
                "net_cash_from_operating": cf_raw.get("operating_activities"),
            },
            "investing_activities": {
                "net_cash_from_investing": cf_raw.get("investing_activities"),
            },
        },
    }


def _compute(f: Dict[str, Any]) -> Dict[str, float]:
    ratios: Dict[str, float] = {}

    # Normalize Screener format if needed
    f = _normalize_for_ratios(f)

    bs = f.get("balance_sheet", {}) or {}
    pl = f.get("profit_loss", {}) or {}
    cf = f.get("cash_flow", {}) or {}

    assets = bs.get("assets", {}) or {}
    liab = bs.get("liabilities", {}) or {}
    eq = bs.get("equity", {}) or {}
    ca = assets.get("current_assets", {}) or {}
    nca = assets.get("non_current_assets", {}) or {}
    cl = liab.get("current_liabilities", {}) or {}
    ncl = liab.get("non_current_liabilities", {}) or {}

    rev = pl.get("revenue", {}) or {}
    exp = pl.get("expenses", {}) or {}
    pm = pl.get("profit_metrics", {}) or {}

    oa = (cf.get("operating_activities", {}) or {})
    ia = (cf.get("investing_activities", {}) or {})

    # Balance sheet values
    total_assets = _n(bs.get("total_assets") or assets.get("total_assets"))
    current_assets = _n(ca.get("total_current_assets") or ca)
    inventory = _n((ca.get("inventories") or {}).get("total") if isinstance(ca.get("inventories"), dict) else ca.get("inventories"))
    trade_rec = _n((ca.get("trade_receivables") or {}).get("total") if isinstance(ca.get("trade_receivables"), dict) else ca.get("trade_receivables"))
    cash = _n(ca.get("cash_and_bank") or ca.get("cash_and_equivalents") or 0)
    fixed_assets = _n(nca.get("property_plant_equipment") or nca.get("total_non_current_assets"))
    current_liab = _n(cl.get("total_current_liabilities") or cl)
    trade_pay = _n((cl.get("trade_payables") or {}).get("total") if isinstance(cl.get("trade_payables"), dict) else cl.get("trade_payables"))
    cpltd = _n(cl.get("current_portion_long_term_debt", 0))
    st_debt = _n(cl.get("short_term_borrowings", 0))
    lt_debt = _n(ncl.get("long_term_borrowings", 0))
    total_liab = _n(liab.get("total_liabilities") or bs.get("total_liabilities"))
    equity = _n(eq.get("total_equity") or eq)
    total_debt = st_debt + lt_debt

    # P&L values
    revenue = _n(rev.get("revenue_from_operations") or rev.get("total_income"))
    total_income = _n(rev.get("total_income"))
    if revenue == 0 and total_income > 0:
        revenue = total_income
    ebitda = _n(pm.get("ebitda"))
    ebit = _n(pm.get("ebit"))
    depreciation = _n(exp.get("depreciation_amortization"))
    interest = _n(exp.get("finance_costs"))
    pbt = _n(pm.get("profit_before_tax"))
    pat = _n(pm.get("profit_after_tax"))

    # Derive EBIT if missing
    if ebit == 0 and ebitda > 0:
        ebit = ebitda - depreciation
    if ebitda == 0 and ebit > 0:
        ebitda = ebit + depreciation

    # COGS
    cogs = _n(exp.get("cost_of_materials")) + _n(exp.get("purchases_traded_goods")) - _n(exp.get("change_in_inventory"))
    if cogs <= 0:
        cogs = max(0, _n(exp.get("total_expenses")) - _n(exp.get("employee_benefit_expense")) - interest - depreciation)

    # Cash flow
    ocf = _n(oa.get("net_cash_from_operating") or oa.get("cash_from_operations"))
    capex = abs(_n(ia.get("purchase_of_assets")))

    capital_employed = total_assets - current_liab

    # ── LIQUIDITY ──
    if current_liab > 0:
        ratios["current_ratio"] = round(_div(current_assets, current_liab), 2)
        if current_assets > 0:
            ratios["quick_ratio"] = round(_div(current_assets - inventory, current_liab), 2)
        if cash > 0:
            ratios["cash_ratio"] = round(_div(cash, current_liab), 2)

    # ── LEVERAGE ──
    if equity > 0:
        ratios["debt_equity"] = round(_div(total_debt, equity), 2)
        # Total Outside Liabilities = Total Assets - Net Worth (excludes equity).
        # Robust regardless of whether `total_liab` was scraped as the full BS size
        # (incl. equity) or as outside-liabilities only.
        tol = (total_assets - equity) if total_assets > equity else max(total_liab - equity, 0)
        ratios["tol_tnw"] = round(_div(tol, equity), 2)
    if total_assets > 0:
        ratios["debt_to_assets"] = round(_div(total_debt, total_assets), 2)

    # ── PROFITABILITY ──
    if revenue > 0:
        if ebitda: ratios["ebitda_margin"] = round(_div(ebitda, revenue) * 100, 2)
        if ebit:   ratios["operating_margin"] = round(_div(ebit, revenue) * 100, 2)
        if pat:    ratios["net_margin"] = round(_div(pat, revenue) * 100, 2)
    if equity > 0 and pat:
        ratios["roe"] = round(_div(pat, equity) * 100, 2)
    if total_assets > 0 and pat:
        ratios["roa"] = round(_div(pat, total_assets) * 100, 2)
    if capital_employed > 0 and ebit:
        ratios["roce"] = round(_div(ebit, capital_employed) * 100, 2)

    # ── COVERAGE ──
    if interest > 0 and ebit:
        ratios["interest_coverage"] = round(_div(ebit, interest), 2)
    if interest > 0 and ebitda:
        ratios["interest_coverage_ebitda"] = round(_div(ebitda, interest), 2)

    # DSCR — prefer banking numerator (PAT + Dep + Interest); disclose basis + estimates.
    principal = cpltd
    estimated = False
    if principal <= 0 and total_debt > 0:
        principal = total_debt / 5.0          # fallback: assume 5-yr amortisation
        estimated = True
    debt_service = interest + principal
    numerator = (pat + depreciation + interest) if pat > 0 else ocf   # cash-accrual basis
    if debt_service > 0 and numerator:
        ratios["dscr"] = round(_div(numerator, debt_service), 2)
        ratios["dscr_estimated"] = estimated
        ratios["dscr_basis"] = "PAT+Dep+Int" if pat > 0 else "OCF"

    # ── EFFICIENCY ──
    if revenue > 0 and total_assets > 0:
        ratios["asset_turnover"] = round(_div(revenue, total_assets), 2)
    if revenue > 0 and fixed_assets > 0:
        ratios["fixed_asset_turnover"] = round(_div(revenue, fixed_assets), 2)
    if cogs > 0 and inventory > 0:
        ratios["inventory_days"] = round((inventory / cogs) * 365, 1)
        ratios["inventory_turnover"] = round(_div(cogs, inventory), 2)
    if revenue > 0 and trade_rec > 0:
        ratios["debtor_days"] = round((trade_rec / revenue) * 365, 1)
    if cogs > 0 and trade_pay > 0:
        ratios["creditor_days"] = round((trade_pay / cogs) * 365, 1)
    if "inventory_days" in ratios and "debtor_days" in ratios:
        ratios["operating_cycle"] = round(ratios["inventory_days"] + ratios["debtor_days"], 1)
    if "operating_cycle" in ratios and "creditor_days" in ratios:
        ratios["cash_conversion_cycle"] = round(ratios["operating_cycle"] - ratios["creditor_days"], 1)

    nwc = current_assets - current_liab
    if nwc > 0 and revenue > 0:
        ratios["working_capital_turnover"] = round(_div(revenue, nwc), 2)
    if revenue > 0 and nwc != 0:
        ratios["nwc_to_revenue"] = round(_div(nwc, revenue) * 100, 2)

    # ── CASH FLOW ──
    if ocf and revenue > 0:
        ratios["ocf_to_sales"] = round(_div(ocf, revenue) * 100, 2)
    if ocf and total_debt > 0:
        ratios["ocf_to_debt"] = round(_div(ocf, total_debt), 2)

    return ratios


def evaluate_covenants(ratios: Dict[str, float], covenants: list) -> list:
    """
    Evaluate covenant conditions against computed ratios.
    covenant: {"ratio_name": "current_ratio", "operator": "gte", "threshold": 1.25}
    Returns list of results with breach status and buffer.
    """
    ops = {"gt": lambda v, t: v > t, "lt": lambda v, t: v < t,
           "gte": lambda v, t: v >= t, "lte": lambda v, t: v <= t}
    results = []
    for c in covenants:
        ratio_name = c.get("ratio_name", "")
        operator = c.get("operator", "gte")
        threshold = float(c.get("threshold", 0))
        value = ratios.get(ratio_name)
        if value is None:
            results.append({**c, "current_value": None, "is_breached": False, "buffer": None, "status": "no_data"})
            continue
        fn = ops.get(operator, ops["gte"])
        is_breached = not fn(value, threshold)
        buffer = value - threshold if operator in ("gt", "gte") else threshold - value
        results.append({
            **c,
            "current_value": round(value, 3),
            "is_breached": is_breached,
            "buffer": round(buffer, 3),
            "status": "breach" if is_breached else ("near_breach" if abs(buffer) < threshold * 0.10 else "ok"),
        })
    return results
