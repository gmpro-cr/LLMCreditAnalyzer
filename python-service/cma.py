"""CMA-style spread, projections and assessments from the deep Screener spread.

Single source of truth for every figure in the detailed CAM: the summary
spread, parameter ratings, DSCR, the term-loan repayment schedule, MPBF and the
sensitivity grid all come from here, so no two sections can disagree.

Conventions
- ₹ crore throughout; years are the Screener fiscal labels ("Mar 2026").
- Term debt = long-term borrowings + lease liabilities. Short-term borrowings are
  working-capital lines assumed to roll over (excluded from scheduled principal);
  current maturities of term debt may sit inside them — the CAM says so and asks
  the RM for the repayment schedule.
- DSCR = (PAT + Dep + Interest) / (Interest + term debt / 5 + proposed TL
  principal) — finance_utils.dscr, the same basis as the rest of the engine.
- Projections are deliberately conservative and exclude other income and
  exceptional items.
"""
from typing import Any, Dict, List, Optional

from finance_utils import EXISTING_DEBT_AMORT_YEARS, TL_TENOR_YEARS, as_number
from finance_utils import dscr as _dscr

WC_TYPES = ("working_capital", "cash_credit", "overdraft", "wc", "cc", "od")
MAX_PROJ_YEARS = 7


def _v(rows: Dict[str, list], key: str, i: int) -> Optional[float]:
    arr = rows.get(key) or []
    return as_number(arr[i]) if 0 <= i < len(arr) else None


def _sum(*vals) -> Optional[float]:
    nums = [v for v in vals if v is not None]
    return round(sum(nums), 2) if nums else None


def _div(a, b) -> Optional[float]:
    return round(a / b, 2) if a is not None and b not in (None, 0) else None


def _pct(a, b) -> Optional[float]:
    return round(a / b * 100, 1) if a is not None and b not in (None, 0) else None


def facility_terms(facility: Dict[str, Any], rm: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Proposed facility as used by the projections. Tenor from RM inputs when
    given (months), else the indicative TL tenor."""
    facility = facility or {}
    amount_cr = (as_number(facility.get("amount_inr")) or 0.0) / 1e7
    ftype = str(facility.get("type") or "term_loan").lower()
    is_wc = ftype in WC_TYPES
    prop = ((rm or {}).get("proposal") or {})
    tenor_m = as_number(prop.get("tenor_months"))
    moratorium_m = as_number(prop.get("moratorium_months")) or 0.0
    tenor_y = max(1, round(tenor_m / 12)) if tenor_m else TL_TENOR_YEARS
    moratorium_y = int(moratorium_m // 12)
    repay_years = max(1, tenor_y - moratorium_y)
    return {
        "type": ftype, "amount_cr": round(amount_cr, 2), "is_wc": is_wc,
        "tenor_years": tenor_y, "tenor_from_rm": bool(tenor_m),
        "moratorium_years": moratorium_y,
        "annual_principal": 0.0 if is_wc else round(amount_cr / repay_years, 2),
        "rate_pct": as_number(prop.get("rate_pct")) or 9.0,
    }


def actuals(deep: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Per-year derived metrics for the reported years."""
    rows = deep.get("rows") or {}
    out = []
    for i, year in enumerate(deep.get("years") or []):
        def g(k, i=i):
            return _v(rows, k, i)
        sales, ebitda, pat, dep, interest = g("sales"), g("ebitda"), g("pat"), g("depreciation"), g("interest")
        nw = g("net_worth") if g("net_worth") is not None else _sum(g("equity_capital"), g("reserves"))
        lt = _sum(g("lt_borrowings"), g("lease_liabilities"))
        st = g("st_borrowings")
        debt = g("borrowings") if g("borrowings") is not None else _sum(lt, st)
        ca = _sum(g("inventories"), g("receivables"), g("cash"), g("loans_advances"), g("other_asset_items"))
        cl_ex_bank = _sum(g("trade_payables"), g("advance_from_customers"), g("other_liability_items"))
        cl = _sum(st, cl_ex_bank)
        tol = (g("total_assets") - nw) if g("total_assets") is not None and nw is not None else None
        prev_sales = _v(rows, "sales", i - 1)
        out.append({
            "year": year, "kind": "actual",
            "sales": sales,
            "sales_growth": _pct(sales - prev_sales, prev_sales) if sales is not None and prev_sales else None,
            "ebitda": ebitda, "ebitda_margin": _pct(ebitda, sales),
            "other_income": g("other_income"), "exceptional": g("exceptional_items"),
            "interest": interest, "depreciation": dep, "pbt": g("pbt"), "tax_pct": g("tax_pct"),
            "pat": pat, "pat_margin": _pct(pat, sales),
            "cash_accruals": _sum(pat, dep),
            "net_worth": nw, "term_debt": lt, "st_debt": st, "total_debt": debt, "tol": tol,
            "net_block": g("net_block"), "cwip": g("cwip"), "investments": g("investments"),
            "inventories": g("inventories"), "receivables": g("receivables"), "cash": g("cash"),
            "trade_payables": g("trade_payables"),
            "current_assets": ca, "current_liabilities": cl, "cl_ex_bank": cl_ex_bank,
            "current_ratio": _div(ca, cl), "nwc": (round(ca - cl, 2) if ca is not None and cl is not None else None),
            "inventory_days": g("inventory_days"), "debtor_days": g("debtor_days"),
            "payable_days": g("payable_days"), "ccc": g("cash_conversion_cycle"),
            "debt_ebitda": _div(debt, ebitda), "term_debt_ebitda": _div(lt, ebitda),
            "debt_equity": _div(debt, nw), "tol_tnw": _div(tol, nw),
            "icr": _div(ebitda, interest), "roce": g("roce_pct"),
            "cfo": g("cfo"), "capex": g("capex_fixed_assets"),
            "fcf": _sum(g("cfo"), g("capex_fixed_assets")),
            "wc_change": _sum(g("wc_receivables"), g("wc_inventory"), g("wc_payables")),
            "dividend_payout_pct": g("dividend_payout_pct"),
        })
    return out


def _cagr(first, last, n) -> Optional[float]:
    if not first or not last or first <= 0 or last <= 0 or n <= 0:
        return None
    return (last / first) ** (1 / n) - 1


def project(act: List[Dict[str, Any]], fac: Dict[str, Any], years: int = 2) -> Dict[str, Any]:
    """Conservative projections (no other income / exceptional items).

    growth  = half the 3-yr sales CAGR, floored at 0 and capped at 10%
    margin  = average EBITDA margin of the last 3 years
    debt    = existing term debt amortises over 5 yrs; WC lines flat; proposed TL
              drawn at the start of year 1 and repaid per facility_terms
    """
    if not act:
        return {"rows": [], "assumptions": {}}
    last = act[-1]
    window = act[-4:] if len(act) >= 4 else act
    cagr = _cagr(window[0]["sales"], last["sales"], len(window) - 1)
    g = min(max((cagr or 0) * 0.5, 0.0), 0.10)
    margins = [a["ebitda_margin"] for a in act[-3:] if a["ebitda_margin"] is not None]
    m = (sum(margins) / len(margins) / 100) if margins else 0.12
    taxes = [a["tax_pct"] for a in act[-3:] if a["tax_pct"] is not None and 0 <= a["tax_pct"] <= 45]
    tax = (sum(taxes) / len(taxes) / 100) if taxes else 0.25
    payouts = [a["dividend_payout_pct"] for a in act[-3:] if a["dividend_payout_pct"] is not None]
    payout = min((sum(payouts) / len(payouts) / 100) if payouts else 0.3, 0.9)
    debts = [a["total_debt"] for a in act[-2:] if a["total_debt"]]
    avg_debt = sum(debts) / len(debts) if debts else None
    rate = (last["interest"] / avg_debt) if last["interest"] and avg_debt else fac["rate_pct"] / 100
    rate = min(max(rate, 0.04), 0.16)

    term0 = last["term_debt"] or 0.0
    st = last["st_debt"] or 0.0
    ex_principal = term0 / EXISTING_DEBT_AMORT_YEARS
    tl_out, term = 0.0, term0
    nw, tol = (last["net_worth"] or 0.0), (last["tol"] or 0.0)
    debt_prev = last["total_debt"] or 0.0
    rows = []
    tail = str(last["year"])[-4:]
    base_year = int(tail) if tail.isdigit() else 2026
    for t in range(1, years + 1):
        sales = (last["sales"] or 0) * (1 + g) ** t
        ebitda = sales * m
        dep = (last["depreciation"] or 0) * 1.05 ** t
        drawn = fac["amount_cr"] if (t == 1 and not fac["is_wc"]) else 0.0
        tl_open = tl_out + drawn
        tl_principal = 0.0 if (fac["is_wc"] or t <= fac["moratorium_years"]) else min(fac["annual_principal"], tl_open)
        tl_out = tl_open - tl_principal
        ex_paid = min(ex_principal, term) if t <= EXISTING_DEBT_AMORT_YEARS else 0.0
        term -= ex_paid
        wc_extra = fac["amount_cr"] if fac["is_wc"] else 0.0
        debt = term + st + tl_out + wc_extra
        interest = rate * (debt_prev + debt) / 2
        pbt = ebitda - dep - interest
        pat = pbt * (1 - tax) if pbt > 0 else pbt
        nw += pat * (1 - payout) if pat > 0 else pat
        tol += debt - debt_prev
        principal = ex_paid + tl_principal
        rows.append({
            "year": f"FY{base_year + t}E", "kind": "projected",
            "sales": round(sales, 1), "sales_growth": round(g * 100, 1),
            "ebitda": round(ebitda, 1), "ebitda_margin": round(m * 100, 1),
            "interest": round(interest, 1), "depreciation": round(dep, 1),
            "pbt": round(pbt, 1), "pat": round(pat, 1), "pat_margin": _pct(pat, sales),
            "cash_accruals": round(pat + dep, 1),
            "net_worth": round(nw, 1), "term_debt": round(term + tl_out, 1), "st_debt": round(st + wc_extra, 1),
            "total_debt": round(debt, 1), "tol": round(tol, 1),
            "debt_ebitda": _div(debt, ebitda), "term_debt_ebitda": _div(term + tl_out, ebitda),
            "debt_equity": _div(debt, nw), "tol_tnw": _div(tol, nw), "icr": _div(ebitda, interest),
            "net_block": last["net_block"],
            "principal_existing": round(ex_paid, 1), "principal_tl": round(tl_principal, 1),
            "tl_opening": round(tl_open, 1), "tl_closing": round(tl_out, 1),
            "tl_interest": round(rate * (tl_open + tl_out) / 2, 1),
            "dscr": _div(pat + dep + interest, interest + principal),
        })
        debt_prev = debt
    return {"rows": rows, "assumptions": {
        "sales_growth_pct": round(g * 100, 1), "hist_cagr_pct": round(cagr * 100, 1) if cagr is not None else None,
        "ebitda_margin_pct": round(m * 100, 1), "tax_rate_pct": round(tax * 100, 1),
        "dividend_payout_pct": round(payout * 100, 1), "interest_rate_pct": round(rate * 100, 2),
        "existing_term_debt_cr": round(term0, 1), "existing_principal_pa_cr": round(ex_principal, 1),
        "wc_lines_cr": round(st, 1),
    }}


def with_dscr(act: List[Dict[str, Any]], fac: Dict[str, Any]) -> None:
    """Pro forma DSCR / FACR on the actual years (existing term debt + proposed TL)."""
    for a in act:
        a["dscr"] = _dscr(a["pat"], a["depreciation"], a["interest"], a["term_debt"], fac["annual_principal"]) \
            if a["pat"] is not None else None
        a["facr"] = _div(a["net_block"], (a["term_debt"] or 0) + (0 if fac["is_wc"] else fac["amount_cr"]))


# ── Parameter assessments (Strong / Moderate / Weak) ─────────────────────────

def _band(ok_strong: bool, ok_moderate: bool) -> str:
    return "Strong" if ok_strong else "Moderate" if ok_moderate else "Weak"


def assess(act: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Rule-based rating per parameter with the evidence used."""
    if not act:
        return {}
    last = act[-1]
    window = act[-4:] if len(act) >= 4 else act
    cagr = _cagr(window[0]["sales"], last["sales"], len(window) - 1)
    margins = [a["ebitda_margin"] for a in act[-3:] if a["ebitda_margin"] is not None]
    avg_m = sum(margins) / len(margins) if margins else 0
    pats = [a["pat"] for a in act[-3:] if a["pat"] is not None]
    c = (cagr or 0) * 100
    em = last["ebitda_margin"] or 0
    de, ds, tt = last["debt_ebitda"] or 99, last.get("dscr") or 0, last["tol_tnw"] or 99
    cr = last["current_ratio"] or 0
    cfo_pos = all((a["cfo"] or 0) > 0 for a in act[-3:])
    return {
        "sales": {"rating": _band(c >= 10 and (last["sales_growth"] or 0) >= 0, c >= 0),
                  "basis": f"3-yr sales CAGR {c:.1f}%, latest YoY {last['sales_growth'] or 0:.1f}%"},
        "profitability": {
            "rating": _band(em >= 15 and em - avg_m >= -2 and all(p > 0 for p in pats),
                            em >= 8 and (last["pat"] or 0) > 0),
            "basis": f"EBITDA margin {em:.1f}% (3-yr avg {avg_m:.1f}%), "
                     f"PAT {'positive' if (last['pat'] or 0) > 0 else 'negative'} in latest year"},
        "leverage": {"rating": _band(de <= 2 and ds >= 1.5 and tt <= 1.5, de <= 3.5 and ds >= 1.25 and tt <= 3),
                     "basis": f"Total debt/EBITDA {de:.2f}x, pro forma DSCR {ds:.2f}x, TOL/TNW {tt:.2f}x"},
        # Bank bands: >= 1.33x (Tandon II benchmark) strong, >= 1.0x moderate.
        "liquidity": {"rating": _band(cr >= 1.33 and cfo_pos, cr >= 1.0 and cfo_pos),
                      "basis": f"Current ratio {cr:.2f}x (approx., Screener classification); operating cash "
                               f"flow {'positive in each' if cfo_pos else 'negative in at least one'} of the last 3 years"},
    }


# ── Sensitivity ──────────────────────────────────────────────────────────────

SCENARIOS = [
    ("Base case", 0.0, 0.0, 0.0),
    ("Sales -10%", -0.10, 0.0, 0.0),
    ("Sales -15%", -0.15, 0.0, 0.0),
    ("EBITDA margin -2 pp", 0.0, -2.0, 0.0),
    ("EBITDA margin -5 pp", 0.0, -5.0, 0.0),
    ("Interest rate +200 bps", 0.0, 0.0, 2.0),
    ("Sales -10% and margin -2 pp", -0.10, -2.0, 0.0),
]


def sensitivity(proj: Dict[str, Any]) -> List[Dict[str, Any]]:
    """DSCR / ICR of the first projected year under each scenario."""
    rows = proj.get("rows") or []
    if not rows:
        return []
    p1 = rows[0]
    a = proj["assumptions"]
    tax = a["tax_rate_pct"] / 100
    principal = p1["principal_existing"] + p1["principal_tl"]
    out = []
    for name, ds, dm, dr in SCENARIOS:
        sales = p1["sales"] * (1 + ds)
        ebitda = sales * (p1["ebitda_margin"] + dm) / 100
        rate = a["interest_rate_pct"]
        interest = p1["interest"] * (rate + dr) / rate if rate else p1["interest"]
        pbt = ebitda - p1["depreciation"] - interest
        pat = pbt * (1 - tax) if pbt > 0 else pbt
        out.append({"scenario": name, "sales": round(sales, 1), "ebitda": round(ebitda, 1), "pat": round(pat, 1),
                    "icr": _div(ebitda, interest),
                    "dscr": _div(pat + p1["depreciation"] + interest, interest + principal)})
    return out


# ── Working-capital assessment (Tandon Committee Method II) ──────────────────

def mpbf(last: Dict[str, Any], fac: Dict[str, Any]) -> Dict[str, Any]:
    ca, cl_x = last.get("current_assets"), last.get("cl_ex_bank")
    if ca is None or cl_x is None:
        return {}
    wcg = ca - cl_x
    margin = 0.25 * ca
    mpbf_v = wcg - margin
    existing = last.get("st_debt") or 0.0
    proposed = fac["amount_cr"] if fac["is_wc"] else 0.0
    return {"year": last.get("year"), "current_assets": round(ca, 1), "cl_ex_bank": round(cl_x, 1),
            "wcg": round(wcg, 1), "margin_25pct_ca": round(margin, 1), "mpbf": round(mpbf_v, 1),
            "existing_wc_borrowings": round(existing, 1), "proposed": round(proposed, 1),
            "headroom": round(mpbf_v - existing - proposed, 1)}


def build(deep: Dict[str, Any], facility: Dict[str, Any], rm: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    fac = facility_terms(facility, rm)
    act = actuals(deep)
    with_dscr(act, fac)
    n_proj = 2 if fac["is_wc"] else min(max(2, fac["tenor_years"]), MAX_PROJ_YEARS)
    proj = project(act, fac, n_proj)
    return {
        "basis": deep.get("basis", "Consolidated"),
        "facility": fac,
        "actuals": act,
        "projections": proj,
        "assessment": assess(act),
        "sensitivity": sensitivity(proj),
        "mpbf": mpbf(act[-1], fac) if act else {},
    }


def ratios_view(cma: Dict[str, Any]) -> Dict[str, Any]:
    """Latest-year ratios in the keys credit_score / risk_flags / cam_tables read."""
    act = cma.get("actuals") or []
    if not act:
        return {}
    a = act[-1]
    cycle = None
    if a.get("inventory_days") is not None and a.get("debtor_days") is not None:
        cycle = a["inventory_days"] + a["debtor_days"]
    return {k: v for k, v in {
        "dscr": a.get("dscr"), "dscr_estimated": True, "dscr_basis": "PAT+Dep+Int",
        "debt_equity": a.get("debt_equity"), "tol_tnw": a.get("tol_tnw"),
        "interest_coverage": a.get("icr"), "current_ratio": a.get("current_ratio"),
        "net_margin": a.get("pat_margin"), "ebitda_margin": a.get("ebitda_margin"),
        "roce": a.get("roce"), "debtor_days": a.get("debtor_days"), "inventory_days": a.get("inventory_days"),
        "creditor_days": a.get("payable_days"), "operating_cycle": cycle,
        "debt_ebitda": a.get("debt_ebitda"), "facr": a.get("facr"),
    }.items() if v is not None}
