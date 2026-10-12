"""Detailed CAM (v2): deterministic tables + analytical commentary per section.

Used when the case has the deep spread (financials["deep"], from screener_deep).
Every number in a table comes from cma.py / the annual-report analysis / the RM's
inputs; the LLM writes commentary that must cite those figures. Anything not
available publicly is shown as "[RM to provide: ...]" and collected in the
"Information Required from RM" section, so the RM can fill it in the Data Room
and regenerate.

Section keys are the UI keys (memo_sections.section_key) directly.
"""
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import cma as cma_mod
import organogram as og
from cam_tables import COVENANTS, _inr, peer_table
from credit_score import compute_scorecard, format_scorecard_md
from ews_checklist import format_ews_checklist_md
from finance_utils import EXISTING_DEBT_AMORT_YEARS, as_number
from validators import audit_facility_amounts, audit_memo_figures, strip_rupee_restatements

logger = logging.getLogger(__name__)

RM = "[RM to provide]"

# (key, title, drafted by LLM)
SECTIONS: List[Tuple[str, str, bool]] = [
    ("executive_summary", "Executive Summary", True),
    ("proposed_structure", "Proposal & Facility Structure", True),
    ("business_profile", "Company & Business Profile", True),
    ("group_organogram", "Group Structure", True),
    ("promoter_background", "Shareholding, Board & Management", True),
    ("industry_analysis", "Industry Outlook", True),
    ("financial_analysis", "Financial Analysis — Summary", True),
    ("sales_profitability", "Revenue & Profitability", True),
    ("leverage_debt", "Leverage, Debt Profile & Debt Servicing", True),
    ("working_capital_analysis", "Liquidity & Working Capital", True),
    ("interim_performance", "Interim Performance", True),
    ("facility_assessment", "Assessment of Facilities & Sensitivity", True),
    ("banking_arrangement", "Banking Arrangement & Credit Ratings", True),
    ("contingent_rpt", "Contingent Liabilities, Related Parties & Audit", True),
    ("peer_comparison", "Peer Comparison", True),
    ("due_diligence", "Due Diligence & Hygiene Checks", True),
    ("risk_summary", "Key Risks & Mitigants", True),
    ("recommendation", "Recommendation, Terms & Covenants", True),
    ("ews_checklist", "EWS Checklist", False),
    ("reference_check", "Reference Check", False),
    ("information_required", "Information Required from RM", False),
]
TITLES = {k: t for k, t, _ in SECTIONS}

CONFIDENCE = {
    "executive_summary": ("medium", "Synthesised from all sections; review each source section"),
    "proposed_structure": ("low", "Facility terms need RM confirmation"),
    "business_profile": ("medium", "Annual report + Screener; customers/suppliers need RM input"),
    "group_organogram": ("medium", "Annual report Form AOC-1; RM to verify the structure"),
    "promoter_background": ("medium", "Shareholding (Screener) and board (annual report); KYC by RM"),
    "industry_analysis": ("medium", "Annual report MD&A and web research"),
    "financial_analysis": ("high", "Computed from Screener statements; verify against audited accounts"),
    "sales_profitability": ("high", "Computed from Screener statements"),
    "leverage_debt": ("medium", "Debt split from Screener schedules; repayment schedule from RM"),
    "working_capital_analysis": ("medium", "Current assets/liabilities on Screener classification (approx.)"),
    "interim_performance": ("high", "Screener quarterly results"),
    "facility_assessment": ("medium", "Indicative projections; tenor/terms from RM"),
    "banking_arrangement": ("low", "Ratings from annual report; lender-wise details from RM"),
    "contingent_rpt": ("medium", "Annual report notes"),
    "peer_comparison": ("medium", "Screener peer data (latest quarter)"),
    "due_diligence": ("low", "Public checks done; bureau/regulatory checks pending with RM"),
    "risk_summary": ("medium", "Synthesised; RM judgement required"),
    "recommendation": ("low", "AI scaffold — recommendation must be authored by RM"),
    "ews_checklist": ("low", "Standard EWS parameters — monitor post-sanction"),
    "reference_check": ("low", "RM to complete"),
    "information_required": ("high", "Generated from data gaps"),
}


# ── formatting ───────────────────────────────────────────────────────────────

def fa(v) -> str:
    """₹ crore amount: Indian grouping, whole crore from 100, one decimal below."""
    n = as_number(v)
    if n is None:
        return "—"
    if n == 0:
        return "Nil"
    if abs(n) >= 100:
        return _inr(n)
    return f"{n:,.1f}" if abs(n) >= 1 or n == 0 else f"{n:,.2f}"


def fx(v) -> str:
    n = as_number(v)
    return "—" if n is None else f"{n:.2f}x"


def fp(v, d: int = 1) -> str:
    n = as_number(v)
    return "—" if n is None else f"{n:.{d}f}%"


def fd(v) -> str:
    n = as_number(v)
    return "—" if n is None else f"{n:.0f}"


_MILLION = re.compile(r"(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)\s*(million|mn|lakhs?)\b", re.I)


def to_crore_text(text: str) -> str:
    """'₹40,080 million' -> '₹4,008 Cr' (annual-report notes are often in ₹ million or lakh)."""
    def sub(m):
        v = as_number(m.group(1))
        if v is None:
            return m.group(0)
        cr = v / 10 if m.group(2).lower() in ("million", "mn") else v / 100
        return f"₹{fa(cr)} Cr"
    return _MILLION.sub(sub, text or "")


_ASSURANCES = re.compile(
    r"\b(unblemished|impeccable|spotless|clean|satisfactory|regular|healthy|sound)\s+"
    r"(banking|account|repayment|credit)\s+(conduct|track[- ]record|history|record)", re.I)


def scrub_assurances(text: str, rm_has_conduct: bool) -> str:
    """Account-conduct claims need the RM's evidence; without it, replace them."""
    if rm_has_conduct:
        return text
    return _ASSURANCES.sub("account conduct [RM to provide: account conduct]", text or "")


def table(head: List[str], rows: List[List[str]], align_right_from: int = 1) -> str:
    if not rows:
        return ""
    sep = "|" + "|".join("---" if i < align_right_from else "---:" for i in range(len(head))) + "|"
    out = ["| " + " | ".join(head) + " |", sep]
    out += ["| " + " | ".join(str(c) if c not in (None, "") else "—" for c in r) + " |" for r in rows]
    return "\n".join(out)


def bullets(items: List[str]) -> str:
    return "\n".join(f"- {i}" for i in items if i)


def src(text: str) -> str:
    return f"_Source: {text}_"


# ── data access helpers ──────────────────────────────────────────────────────

def _ar_topic(ar: Dict[str, Any], topic: str) -> Dict[str, Any]:
    return ((ar or {}).get("topics") or {}).get(topic) or {}


def _rm(rm: Dict[str, Any], *path, default=None):
    cur: Any = rm or {}
    for p in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(p)
    return cur if cur not in (None, "", []) else default


def _years(cm: Dict[str, Any]) -> List[Dict[str, Any]]:
    return (cm.get("actuals") or []) + ((cm.get("projections") or {}).get("rows") or [])


def _fy(label: str) -> str:
    m = re.search(r"(\d{4})", str(label))
    if not m:
        return str(label)
    return f"FY{m.group(1)[2:]}" + ("E" if str(label).endswith("E") else "")


# ── deterministic section parts ──────────────────────────────────────────────

def rating_summary(ar: Dict[str, Any]) -> str:
    """'ICRA: AA+ (Stable) / A1+; CARE: AA+ (Stable) / A1+' from the extracted rating rows."""
    by: Dict[str, Dict[str, set]] = {}
    for r in _ar_topic(ar, "ratings").get("ratings") or []:
        agency, raw = (r.get("agency") or "").strip(), str(r.get("rating") or "")
        if not agency or not raw or "withdrawn" in str(r.get("action") or "").lower():
            continue
        d = by.setdefault(agency.upper(), {"lt": set(), "st": set(), "outlook": set()})
        for g in re.findall(r"(A1\+?|A[1-4]\+?|AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|C|D)(?![A-Za-z0-9])",
                            re.sub(r"\[?(ICRA|CARE|CRISIL|IND|Brickwork|Acuite)\]?", " ", raw, flags=re.I)):
            (d["st"] if re.match(r"A[1-4]", g) else d["lt"]).add(g)
        if r.get("outlook"):
            d["outlook"].add(str(r["outlook"]).title())
    order = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-"]
    parts = []
    for ag, d in by.items():
        lt = sorted(d["lt"], key=lambda g: order.index(g) if g in order else 99)
        txt = (lt[0] if lt else "") + (f" ({'/'.join(sorted(d['outlook']))})" if lt and d["outlook"] else "")
        if d["st"]:
            txt += (" / " if txt else "") + sorted(d["st"])[0]
        if txt:
            parts.append(f"{ag}: {txt}")
    return "; ".join(parts)


def snapshot_table(ctx: Dict[str, Any]) -> str:
    cm, fac = ctx["cma"], ctx["cma"]["facility"]
    a = (cm.get("actuals") or [{}])[-1]
    ext = rating_summary(ctx["ar"]) or RM
    rows = [
        ["Borrower", ctx["company"]],
        ["Sector", ctx.get("sector") or "—"],
        ["Proposed facility", f"{fac['type'].replace('_', ' ').title()} — ₹{fac['amount_cr']:,.2f} Cr"],
        ["External rating", ext],
        ["Internal rating (model)", ctx.get("grade") or "—"],
        [f"Revenue ({_fy(a.get('year'))}, {cm['basis'].lower()})", f"₹{fa(a.get('sales'))} Cr"],
        ["EBITDA margin / PAT", f"{fp(a.get('ebitda_margin'))} / ₹{fa(a.get('pat'))} Cr"],
        ["Net worth / Total debt", f"₹{fa(a.get('net_worth'))} Cr / ₹{fa(a.get('total_debt'))} Cr"],
        ["Debt/EBITDA · TOL/TNW", f"{fx(a.get('debt_ebitda'))} · {fx(a.get('tol_tnw'))}"],
        ["Pro forma DSCR · ICR", f"{fx(a.get('dscr'))} · {fx(a.get('icr'))}"],
    ]
    return table(["Parameter", "Value"], rows, align_right_from=99)


def facility_table(ctx: Dict[str, Any]) -> str:
    fac, rm = ctx["cma"]["facility"], ctx["rm"]
    p = _rm(rm, "proposal") or {}
    tenor = (f"{p.get('tenor_months')} months" if p.get("tenor_months")
             else f"{fac['tenor_years']} years (indicative — {RM})")
    repay = p.get("repayment") or (
        "Annual review (revolving)" if fac["is_wc"] else
        f"₹{fac['annual_principal']:,.2f} Cr p.a. over {fac['tenor_years'] - fac['moratorium_years']} years "
        f"(indicative — {RM})")
    rows = [
        ["Facility", fac["type"].replace("_", " ").title()],
        ["Amount (₹ Cr)", f"{fac['amount_cr']:,.2f}"],
        ["Proposal type", p.get("proposal_type") or RM],
        ["Purpose / end-use", p.get("purpose") or RM],
        ["Tenor", tenor],
        ["Moratorium", f"{p.get('moratorium_months')} months" if p.get("moratorium_months") else ("—" if fac["is_wc"] else RM)],
        ["Repayment", repay],
        ["Pricing", p.get("pricing") or RM],
        ["Primary security", _rm(rm, "security", "primary") or RM],
        ["Collateral security", _rm(rm, "security", "collateral") or RM],
        ["Guarantees", _rm(rm, "security", "guarantees") or RM],
    ]
    return table(["Term", "Proposed"], rows, align_right_from=99)


def spread_table(ctx: Dict[str, Any]) -> str:
    cols = _years(ctx["cma"])
    head = ["Particulars (₹ Cr)"] + [_fy(c["year"]) for c in cols]
    spec = [
        ("Net sales", "sales", fa), ("Sales growth", "sales_growth", fp),
        ("EBITDA", "ebitda", fa), ("EBITDA margin", "ebitda_margin", fp),
        ("Other income (incl. exceptional)", "other_income", fa), ("Exceptional items", "exceptional", fa),
        ("Interest", "interest", fa), ("Depreciation", "depreciation", fa),
        ("PBT", "pbt", fa), ("PAT", "pat", fa), ("PAT margin", "pat_margin", fp),
        ("Cash accruals (PAT + Dep)", "cash_accruals", fa),
        ("Net worth (TNW)", "net_worth", fa), ("Term debt (LT + lease)", "term_debt", fa),
        ("Short-term / WC borrowings", "st_debt", fa), ("Total debt", "total_debt", fa),
        ("Total outside liabilities", "tol", fa),
        ("Current assets (approx.)", "current_assets", fa), ("Current liabilities (approx.)", "current_liabilities", fa),
        ("Net fixed assets", "net_block", fa),
        ("Inventory days", "inventory_days", fd), ("Debtor days", "debtor_days", fd),
        ("Creditor days", "payable_days", fd), ("Cash conversion cycle (days)", "ccc", fd),
        ("Total debt / EBITDA", "debt_ebitda", fx), ("Term debt / EBITDA", "term_debt_ebitda", fx),
        ("Total debt / TNW", "debt_equity", fx), ("TOL / TNW", "tol_tnw", fx),
        ("Current ratio (approx.)", "current_ratio", fx), ("Interest coverage (EBITDA)", "icr", fx),
        ("DSCR (pro forma)", "dscr", fx), ("ROCE", "roce", fp),
        ("Operating cash flow", "cfo", fa), ("Capex (net)", "capex", fa), ("Free cash flow", "fcf", fa),
    ]
    rows = [[label] + [fn(c.get(key)) for c in cols] for label, key, fn in spec]
    return table(head, rows)


def assumptions_md(ctx: Dict[str, Any]) -> str:
    cm = ctx["cma"]
    a = (cm.get("projections") or {}).get("assumptions") or {}
    fac = cm["facility"]
    items = [
        f"Basis: **{cm['basis']}** financial statements (Screener.in); the borrower entity's standalone "
        f"headline figures are shown in the Group Structure section. Verify against audited accounts.",
        f"Projections ({_fy(((cm.get('projections') or {}).get('rows') or [{}])[0].get('year', ''))} onward) are "
        f"conservative and indicative: sales growth {fp(a.get('sales_growth_pct'))} p.a. (half the 3-yr CAGR of "
        f"{fp(a.get('hist_cagr_pct'))}, floored at 0% and capped at 10%), EBITDA margin {fp(a.get('ebitda_margin_pct'))} "
        f"(3-yr average), tax {fp(a.get('tax_rate_pct'))}, dividend payout {fp(a.get('dividend_payout_pct'))}; "
        f"other income and exceptional items excluded.",
        f"Debt: existing term debt of ₹{fa(a.get('existing_term_debt_cr'))} Cr assumed to amortise over "
        f"{EXISTING_DEBT_AMORT_YEARS} years (₹{fa(a.get('existing_principal_pa_cr'))} Cr p.a.); "
        + (f"short-term/WC lines of ₹{fa(a.get('wc_lines_cr'))} Cr assumed to roll over; " if a.get('wc_lines_cr') else "no short-term/WC borrowings; ")
        + f"effective finance-cost rate {fp(a.get('interest_rate_pct'), 2)} (reported finance costs incl. lease and other charges ÷ average debt).",
        (f"Proposed {fac['type'].replace('_', ' ')} of ₹{fac['amount_cr']:,.2f} Cr drawn at the start of the first "
         f"projected year and repaid ₹{fac['annual_principal']:,.2f} Cr p.a."
         + ("" if fac["tenor_from_rm"] else f" (indicative {fac['tenor_years']}-year tenor — {RM} actual tenor)"))
        if not fac["is_wc"] else
        f"Proposed WC facility of ₹{fac['amount_cr']:,.2f} Cr assumed fully utilised.",
        "Net fixed assets held flat in projections (maintenance capex assumed equal to depreciation); "
        "no growth capex is modelled unless the RM provides a capex plan.",
        "DSCR = (PAT + Depreciation + Interest) / (Interest + scheduled principal of term debt + proposed TL). "
        "Current maturities of long-term debt may be classified within short-term borrowings — obtain the "
        "repayment schedule to firm up DSCR.",
    ]
    return bullets(items)


def assessment_table(ctx: Dict[str, Any]) -> str:
    asmt = ctx["cma"].get("assessment") or {}
    names = [("sales", "Sales"), ("profitability", "Profitability (EBITDA / PAT)"),
             ("leverage", "Leverage & debt servicing"), ("liquidity", "Liquidity")]
    rows = [[n, asmt[k]["rating"], asmt[k]["basis"]] for k, n in names if k in asmt]
    return table(["Parameter", "Assessment", "Basis"], rows, align_right_from=99)


def rating_line(ctx: Dict[str, Any], key: str, label: str) -> str:
    a = (ctx["cma"].get("assessment") or {}).get(key)
    return f"**{label}: {a['rating']}** — {a['basis']}." if a else ""


def cost_table(ctx: Dict[str, Any]) -> str:
    deep = ctx["deep"]
    rows_d = deep.get("rows") or {}
    yrs = deep.get("years") or []
    spec = [("Material cost", "material_cost_pct"), ("Manufacturing cost", "manufacturing_cost_pct"),
            ("Employee cost", "employee_cost_pct"), ("Other cost", "other_cost_pct"), ("EBITDA margin", "opm_pct")]
    rows = [[lab] + [fp(v) for v in (rows_d.get(k) or [])] for lab, k in spec if any(v is not None for v in rows_d.get(k) or [])]
    return table(["% of sales"] + [_fy(y) for y in yrs], rows)


def segment_table(ctx: Dict[str, Any]) -> str:
    segs = _ar_topic(ctx["ar"], "business").get("segments") or []
    rows = [[s.get("name") or "—", fa(s.get("revenue_cr")), fp(s.get("share_pct")) if s.get("share_pct") else "—",
             (s.get("comment") or "")[:160]] for s in segs[:12] if s.get("name")]
    return table(["Segment / business", "Revenue (₹ Cr)", "Share", "Comment"], rows, align_right_from=1)


def counterparties_table(items: List[Dict[str, Any]], kind: str) -> str:
    rows = [[i.get("name") or "—", fp(as_number(i.get("share_pct"))), i.get("years") or "—", i.get("remarks") or "—"]
            for i in items if i.get("name")]
    return table([f"Top {kind}", "Share of total", "Relationship (yrs)", "Remarks"], rows, align_right_from=1)


def entity_table(ctx: Dict[str, Any]) -> str:
    ents = (ctx["group"] or {}).get("entities") or []
    rows = []
    order = [k for k, _t in og.COLUMNS]
    for e in sorted(ents, key=lambda x: (order.index(og.column_of(x)), -(as_number(x.get("turnover_cr")) or 0))):
        col = dict(og.COLUMNS)[og.column_of(e)]
        country = e.get("country") or ("India" if str(e.get("currency") or "").upper() == "INR" else "—")
        rows.append([e.get("name"), col.replace("Subsidiaries — ", "Subsidiary — ").replace("Joint ventures & associates", "JV / associate"),
                     country,
                     fp(e.get("holding_pct"), 2) if e.get("holding_pct") is not None else "—",
                     fa(e.get("turnover_cr")), fa(e.get("pat_cr")), fa(e.get("net_worth_cr"))])
    return table(["Entity", "Type", "Country", "Holding", "Turnover (₹ Cr)", "PAT (₹ Cr)", "Net worth (₹ Cr)"],
                 rows, align_right_from=3)


def standalone_table(ctx: Dict[str, Any]) -> str:
    sa = (ctx["deep"] or {}).get("standalone") or {}
    yrs, r = sa.get("years") or [], sa.get("rows") or {}
    if not yrs:
        return ""
    spec = [("Net sales", "sales"), ("EBITDA", "ebitda"), ("Interest", "interest"), ("PAT", "pat"),
            ("Net worth", "net_worth"), ("Borrowings", "borrowings"), ("Investments", "investments")]
    rows = [[lab] + [fa(v) for v in r.get(k) or []] for lab, k in spec]
    return table(["Borrower entity — standalone (₹ Cr)"] + [_fy(y) for y in yrs], rows)


def shareholding_table(ctx: Dict[str, Any]) -> str:
    sh = (ctx["deep"] or {}).get("shareholding") or {}
    per, rows_d = sh.get("periods") or [], sh.get("rows") or {}
    rows = []
    for label, vals in rows_d.items():
        fn = (lambda v: f"{int(v):,}" if v is not None else "—") if "Shareholders" in label else (lambda v: fp(v, 2))
        rows.append([label] + [fn(v) for v in vals])
    return table(["Category (% holding)"] + per, rows)


def board_table(ctx: Dict[str, Any]) -> str:
    b = _ar_topic(ctx["ar"], "board").get("directors") or []
    rows = [[d.get("name"), d.get("designation") or "—", d.get("category") or "—", d.get("din") or "—",
             "Pending (RM)"] for d in b if d.get("name")]
    return table(["Director", "Designation", "Category", "DIN", "Defaulter / CIBIL check"], rows, align_right_from=99)


def regulatory_checks_table(ctx: Dict[str, Any]) -> str:
    conduct = _rm(ctx["rm"], "conduct") or {}
    def st(k):
        v = conduct.get(k)
        return v if v else "Pending — RM"
    rows = [
        ["Directors on RBI / CIBIL defaulter or wilful defaulter lists", st("defaulter_checks")],
        ["Litigation by lenders against the borrower or directors", st("litigation")],
        ["Common directorship with defaulting / stressed companies", st("common_directorship")],
        ["Promoters / directors are Politically Exposed Persons", st("pep")],
        ["Relationship of directors with the bank's directors / senior management", st("related_to_bank")],
        ["Promoter shares pledged", st("pledge")],
    ]
    return table(["Check", "Status / remarks"], rows, align_right_from=99)


def quarter_table(ctx: Dict[str, Any]) -> str:
    q = (ctx["deep"] or {}).get("quarters") or {}
    per, r = q.get("periods") or [], q.get("rows") or {}
    if not per:
        return ""
    keep = per[-5:]
    off = len(per) - len(keep)
    def yoy(key, i):
        j = off + i
        cur = (r.get(key) or [None] * len(per))[j]
        prev = (r.get(key) or [None] * len(per))[j - 4] if j - 4 >= 0 else None
        return fp((cur - prev) / abs(prev) * 100) if cur is not None and prev not in (None, 0) else "—"
    spec = [("Sales", "sales", fa), ("EBITDA", "ebitda", fa), ("EBITDA margin", "opm_pct", fp),
            ("Other income", "other_income", fa), ("Interest", "interest", fa), ("Depreciation", "depreciation", fa),
            ("PBT", "pbt", fa), ("PAT", "pat", fa)]
    rows = [[lab] + [fn((r.get(k) or [None] * len(per))[off + i]) for i in range(len(keep))] for lab, k, fn in spec]
    rows.append(["Sales growth YoY"] + [yoy("sales", i) for i in range(len(keep))])
    rows.append(["PAT growth YoY"] + [yoy("pat", i) for i in range(len(keep))])
    return table(["Quarter (₹ Cr)"] + keep, rows)


def debt_table(ctx: Dict[str, Any]) -> str:
    act = ctx["cma"].get("actuals") or []
    spec = [("Long-term borrowings + leases", "term_debt", fa), ("Short-term / WC borrowings", "st_debt", fa),
            ("Total debt", "total_debt", fa), ("Net worth", "net_worth", fa), ("Total debt / TNW", "debt_equity", fx),
            ("Total debt / EBITDA", "debt_ebitda", fx), ("Interest coverage (EBITDA)", "icr", fx),
            ("DSCR (pro forma)", "dscr", fx), ("FACR (NFA / term debt + proposed TL)", "facr", fx)]
    return table(["₹ Cr"] + [_fy(a["year"]) for a in act], [[l] + [f(a.get(k)) for a in act] for l, k, f in spec])


def instruments_table(ctx: Dict[str, Any]) -> str:
    ins = _ar_topic(ctx["ar"], "borrowings").get("instruments") or []
    seen, rows = set(), []
    for i in ins:
        key = (i.get("type"), i.get("amount_cr"))
        if key in seen or not i.get("type"):
            continue
        seen.add(key)
        rows.append([i.get("type"), "Secured" if i.get("secured") else "Unsecured" if i.get("secured") is False else "—",
                     fa(i.get("amount_cr")), i.get("pricing") or "—", (i.get("repayment") or "—")[:90],
                     (i.get("covenant_or_trigger") or i.get("security") or "—")[:110]])
    return table(["Instrument", "Nature", "Amount (₹ Cr)", "Pricing", "Repayment", "Security / trigger"],
                 rows[:14], align_right_from=2)


def covenant_test_table(ctx: Dict[str, Any]) -> str:
    rv = ctx["ratios"]
    rows = []
    for key, label, op, thr, unit in COVENANTS + [("debt_ebitda", "Total Debt / EBITDA", "<=", 3.50, "x")]:
        v = as_number(rv.get(key))
        if v is None:
            rows.append([f"{label} {op} {thr:.2f}{unit}", "Not computable", "To be tested on audited CMA"])
            continue
        ok = v <= thr if op == "<=" else v >= thr
        status = "Complied" if ok else "Not complied"
        if key == "current_ratio" and not ok:
            # Screener's split of current items is approximate; never call this a breach.
            status = "Below benchmark on approx. classification — verify from audited balance sheet"
        rows.append([f"{label} {op} {thr:.2f}{unit}", f"{v:.2f}{unit}", status])
    return table(["Covenant", "Latest actual", "Status"], rows, align_right_from=1)


def liquidity_table(ctx: Dict[str, Any]) -> str:
    act = ctx["cma"].get("actuals") or []
    spec = [("Inventories", "inventories", fa), ("Trade receivables", "receivables", fa), ("Cash & equivalents", "cash", fa),
            ("Total current assets (approx.)", "current_assets", fa), ("Trade payables", "trade_payables", fa),
            ("Short-term borrowings", "st_debt", fa), ("Total current liabilities (approx.)", "current_liabilities", fa),
            ("Net working capital", "nwc", fa), ("Current ratio", "current_ratio", fx),
            ("Inventory days", "inventory_days", fd), ("Debtor days", "debtor_days", fd),
            ("Creditor days", "payable_days", fd), ("Cash conversion cycle", "ccc", fd)]
    return table(["₹ Cr / days"] + [_fy(a["year"]) for a in act], [[l] + [f(a.get(k)) for a in act] for l, k, f in spec])


def cashflow_table(ctx: Dict[str, Any]) -> str:
    act = ctx["cma"].get("actuals") or []
    spec = [("Cash accruals (PAT + Dep)", "cash_accruals"), ("Working-capital changes", "wc_change"),
            ("Operating cash flow", "cfo"), ("Capex (net)", "capex"), ("Free cash flow", "fcf")]
    return table(["₹ Cr"] + [_fy(a["year"]) for a in act], [[l] + [fa(a.get(k)) for a in act] for l, k in spec])


def repayment_table(ctx: Dict[str, Any]) -> str:
    rows_p = (ctx["cma"].get("projections") or {}).get("rows") or []
    if ctx["cma"]["facility"]["is_wc"] or not rows_p:
        return ""
    rows = [[_fy(r["year"]), fa(r["tl_opening"]), fa(r["principal_tl"]), fa(r["tl_closing"]), fa(r["tl_interest"]),
             fa(r["principal_existing"]), fa(r["cash_accruals"]), fx(r["dscr"])] for r in rows_p]
    return table(["Year", "Proposed TL opening", "TL principal", "TL closing", "TL interest (est.)",
                  "Existing term-debt principal", "Cash accruals", "DSCR (all debt)"], rows)


def mpbf_table(ctx: Dict[str, Any]) -> str:
    m = ctx["cma"].get("mpbf") or {}
    if not m:
        return ""
    rows = [["Total current assets (approx.)", fa(m["current_assets"])],
            ["Less: current liabilities other than bank borrowings", fa(m["cl_ex_bank"])],
            ["Working capital gap (WCG)", fa(m["wcg"])], ["Less: 25% of current assets (margin)", fa(m["margin_25pct_ca"])],
            ["Maximum permissible bank finance (MPBF)", fa(m["mpbf"])],
            ["Existing short-term / WC borrowings", fa(m["existing_wc_borrowings"])],
            ["Proposed WC facility", fa(m["proposed"])], ["Headroom / (excess)", fa(m["headroom"])]]
    return table([f"Tandon Method II — {_fy(m.get('year'))} (₹ Cr)", "Amount"], rows)


def sensitivity_table(ctx: Dict[str, Any]) -> str:
    s = ctx["cma"].get("sensitivity") or []
    rows = [[r["scenario"], fa(r["sales"]), fa(r["ebitda"]), fa(r["pat"]), fx(r["icr"]), fx(r["dscr"])] for r in s]
    yr = _fy((((ctx["cma"].get("projections") or {}).get("rows") or [{}])[0]).get("year", ""))
    return table([f"Scenario ({yr})", "Sales", "EBITDA", "PAT", "ICR", "DSCR"], rows)


def ratings_table(ctx: Dict[str, Any]) -> str:
    rs = _ar_topic(ctx["ar"], "ratings").get("ratings") or []
    rows = [[r.get("agency"), (r.get("facility") or "—")[:70], r.get("rating") or "—", r.get("outlook") or "—",
             r.get("action") or "—", r.get("as_of") or "—"] for r in rs if r.get("agency")]
    return table(["Agency", "Facility / instrument", "Rating", "Outlook", "Action", "As of"], rows, align_right_from=99)


def lenders_table(ctx: Dict[str, Any]) -> str:
    rows_in = _rm(ctx["rm"], "banking") or []
    if rows_in:
        rows = [[b.get("bank"), b.get("facility"), fa(as_number(b.get("sanctioned_cr"))), fa(as_number(b.get("outstanding_cr"))),
                 b.get("security") or "—", b.get("remarks") or "—"] for b in rows_in if b.get("bank")]
        return table(["Lender", "Facility", "Sanctioned (₹ Cr)", "Outstanding (₹ Cr)", "Security", "Remarks"], rows, align_right_from=2)
    a = (ctx["cma"].get("actuals") or [{}])[-1]
    rows = [[RM + " — lender-wise break-up", "Term loans / NCDs / ECB", "—", fa(a.get("term_debt")), "—",
             f"Per balance sheet {_fy(a.get('year'))}"],
            [RM + " — consortium / multiple banking", "Working capital (FB + NFB)", "—", fa(a.get("st_debt")), "—",
             "Short-term borrowings per balance sheet"]]
    return table(["Lender", "Facility", "Sanctioned (₹ Cr)", "Outstanding (₹ Cr)", "Security", "Remarks"], rows, align_right_from=2)


def contingent_table(ctx: Dict[str, Any]) -> str:
    c = _ar_topic(ctx["ar"], "contingent")
    rows = [[i.get("nature"), fa(i.get("current_year_cr")), fa(i.get("previous_year_cr"))] for i in c.get("items") or [] if i.get("nature")]
    if c.get("capital_commitments_cr") is not None:
        rows.append(["Capital commitments (not provided for)", fa(c["capital_commitments_cr"]), "—"])
    return table([f"Contingent liabilities & commitments ({c.get('basis') or 'per annual report'})", "Current year (₹ Cr)",
                  "Previous year (₹ Cr)"], rows)


def rpt_table(ctx: Dict[str, Any]) -> str:
    items = _ar_topic(ctx["ar"], "related_party").get("items") or []
    items = sorted([i for i in items if i.get("party")], key=lambda i: -(as_number(i.get("amount_cr")) or 0))[:12]
    rows = [[i.get("party"), i.get("relationship") or "—", i.get("nature") or "—", fa(i.get("amount_cr"))] for i in items]
    return table(["Related party", "Relationship", "Nature", "Amount (₹ Cr)"], rows, align_right_from=3)


def auditor_md(ctx: Dict[str, Any]) -> str:
    a = _ar_topic(ctx["ar"], "auditor")
    if not a:
        return ""
    lines = [f"**Statutory auditor:** {a.get('auditor') or '—'} · **Opinion:** {(a.get('opinion') or '—').title()}"]
    for label, key in (("Qualifications", "qualifications"), ("Emphasis of matter", "emphasis_of_matter"),
                       ("Key audit matters", "key_audit_matters"), ("CARO adverse remarks", "caro_observations"),
                       ("CARO confirmations on borrowings", "caro_confirmations")):
        vals = a.get(key) or []
        lines.append(f"**{label}:** " + ("None reported." if not vals else ""))
        if vals:
            lines.append(bullets([str(v) for v in vals[:6]]))
    return "\n\n".join(lines)


def due_diligence_table(ctx: Dict[str, Any]) -> str:
    ar, rm = ctx["ar"], ctx["rm"]
    conduct = _rm(rm, "conduct") or {}
    fy = ar.get("fiscal_year") or "latest"
    ratings = _ar_topic(ar, "ratings").get("ratings") or []
    aud = _ar_topic(ar, "auditor")
    caro = aud.get("caro_observations") or []
    refs = _rm(rm, "references") or []
    def pend(k, label="Pending — RM"):
        return ("Done", conduct[k]) if conduct.get(k) else (label, "")
    rows = [
        ["External credit rating", "Done" if ratings else "Pending — RM",
         f"Annual report {fy}: {rating_summary(ar)}" if ratings else ""],
        ["Statutory auditor's opinion", "Done" if aud else "Pending — RM",
         f"{(aud.get('opinion') or '—').title()} opinion; {len(aud.get('key_audit_matters') or [])} key audit matter(s)" if aud else ""],
        ["CARO adverse remarks", "Done" if aud else "Pending — RM", f"{len(caro)} remark(s) — see Contingent Liabilities section" if aud else ""],
        ["Contingent liabilities", "Done" if _ar_topic(ar, "contingent") else "Pending — RM", "Annual report notes" if _ar_topic(ar, "contingent") else ""],
        ["Adverse news / litigation (web)", "Done" if ctx.get("research") else "Pending", "Web research brief — see Key Risks" if ctx.get("research") else ""],
        ["CIBIL / CMR", *pend("cibil_cmr")],
        ["CRILC / SMA status", *pend("crilc")],
        ["RBI defaulter / wilful defaulter lists", *pend("defaulter_checks")],
        ["MCA defaulter list & ROC charge search", *pend("roc_charges")],
        ["AML / sanctions screening", *pend("aml")],
        ["GST filing regularity", *pend("gst")],
        ["Promoter pledge", *pend("pledge")],
        ["Account conduct with existing lenders", *pend("account_conduct")],
        ["Reference checks", "Done" if refs else "Pending — RM", f"{len(refs)} reference(s) recorded" if refs else ""],
        ["Site / plant visit", *pend("site_visit")],
    ]
    if ctx["cma"]["facility"]["is_wc"]:
        rows.append(["Stock audit / stock statement", *pend("stock_audit")])
    return table(["Check", "Status", "Source / remarks"], rows, align_right_from=99)


def financial_covenants_table() -> str:
    rows = [[label, f"{op} {thr:.2f}{unit}", "Annual (audited) / half-yearly"] for _k, label, op, thr, unit in COVENANTS]
    rows.append(["Total Debt / EBITDA", "<= 3.50x", "Annual (audited)"])
    return table(["Financial covenant", "Threshold", "Testing"], rows, align_right_from=99)


def general_covenants_table(ctx: Dict[str, Any]) -> str:
    fac = ctx["cma"]["facility"]
    rows = [
        ["Insurance of assets charged to the bank (bank clause)", "Annual"],
        ["Audited financials within 180 days; quarterly results / call report within 45 days", "Annual / quarterly"],
        ["External rating to be maintained; downgrade by two notches triggers review", "Ongoing"],
        ["No change in shareholding / management control without prior consent", "Ongoing"],
        ["Unsecured loans from promoters / group subordinated to bank debt", "Ongoing"],
        ["Site / plant visit", "Annual"],
    ]
    if fac["is_wc"]:
        rows.insert(1, ["Monthly stock & book-debt statements; stock audit", "Monthly / annual"])
    else:
        rows.insert(1, ["End-use certificate from statutory auditor", "Within 90 days of disbursement"])
    return table(["General covenant", "Frequency"], rows, align_right_from=99)


def info_requests(ctx: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    """(priority, item, why / where used)."""
    rm, fac, ar = ctx["rm"], ctx["cma"]["facility"], ctx["ar"]
    p = _rm(rm, "proposal") or {}
    sec = _rm(rm, "security") or {}
    conduct = _rm(rm, "conduct") or {}
    out = []
    def need(cond, pri, item, why):
        if cond:
            out.append((pri, item, why))
    need(not p.get("purpose"), "Before sanction", "Purpose / end-use of the facility", "Proposal; end-use covenant")
    need(not p.get("tenor_months") and not fac["is_wc"], "Before sanction", "Tenor, moratorium and repayment schedule",
         "Projections and DSCR use an indicative 5-year tenor")
    need(not p.get("pricing"), "Before sanction", "Pricing (benchmark + spread) and fees", "Proposal")
    need(not sec.get("primary"), "Before sanction", "Primary security and charge type (exclusive / pari passu)", "Security snapshot")
    need(not sec.get("collateral"), "Before sanction", "Collateral details with valuation and date", "Security cover")
    need(not sec.get("guarantees"), "Before sanction", "Personal / corporate guarantees with guarantor net worth", "Security")
    need(not _rm(rm, "banking"), "Before sanction", "Lender-wise banking arrangement (FB/NFB/TL: sanctioned, outstanding, security)",
         "Banking arrangement; system exposure")
    need(True, "Before sanction", "Repayment schedule of existing term debt (incl. current maturities)",
         "Firms up DSCR (currently estimated at term debt / 5)")
    need(not conduct.get("cibil_cmr"), "Before sanction", "CIBIL / CMR report of the borrower", "Due diligence")
    need(not conduct.get("crilc"), "Before sanction", "CRILC SMA status and exposure report", "Due diligence")
    need(not conduct.get("defaulter_checks"), "Before sanction", "RBI / CIBIL defaulter and wilful-defaulter checks on company and directors",
         "Board table; due diligence")
    need(not conduct.get("account_conduct"), "Before sanction", "Account conduct with existing lenders (overdues, devolvements, overdrawings)",
         "Banking arrangement")
    need(not conduct.get("roc_charges"), "Before sanction", "ROC charge search", "Security; existing charges")
    need(not (ctx.get("group") or {}).get("verified"), "Before sanction", "Confirm the group structure (organogram) shown",
         "Group Structure (auto-extracted from annual report)")
    need(not conduct.get("pledge"), "For completeness", "Promoter shareholding pledge status", "Shareholding")
    need(not _rm(rm, "customers"), "For completeness", "Top 10 customers with share of sales and relationship vintage",
         "Business profile; concentration risk")
    need(not _rm(rm, "suppliers"), "For completeness", "Top 10 suppliers with share of purchases", "Business profile")
    need(not _ar_topic(ar, "business").get("segments"), "For completeness", "Product / segment-wise revenue split (volume and value)",
         "Revenue analysis")
    need(not _rm(rm, "references"), "For completeness", "Reference checks (banker, customer, supplier)", "Reference check")
    need(not conduct.get("site_visit"), "For completeness", "Site / plant visit report", "Due diligence")
    need(fac["is_wc"] and not _rm(rm, "working_capital", "stock_statement_date"), "Before sanction",
         "Latest stock statement and debtor ageing (< 90 / > 90 days)", "Drawing power / MPBF")
    need(not ar.get("topics"), "Before sanction", "Latest audited annual report (could not be analysed automatically)",
         "Ratings, borrowings, contingent liabilities, auditor observations")
    return out


def info_required_md(ctx: Dict[str, Any]) -> str:
    items = info_requests(ctx)
    if not items:
        return "All information requested for this CAM has been provided."
    rows = [[str(i + 1), pri, item, why] for i, (pri, item, why) in enumerate(items)]
    return ("_The items below could not be sourced from public data. Fill them in the Data Room (RM Inputs) "
            "and regenerate the CAM; each item replaces the matching “[RM to provide]” placeholder._\n\n"
            + table(["#", "Priority", "Information", "Used in / why"], rows, align_right_from=99))


def reference_md(ctx: Dict[str, Any]) -> str:
    refs = _rm(ctx["rm"], "references") or []
    rows = [[r.get("party") or "—", r.get("relationship") or "—", r.get("contact") or "—", r.get("date") or "—",
             r.get("feedback") or "—"] for r in refs]
    if not rows:
        rows = [["", "Banker", "", "", ""], ["", "Customer", "", "", ""], ["", "Supplier", "", "", ""]]
    return ("_" + ("Recorded by the RM." if refs else "To be completed by the RM as part of due diligence.") + "_\n\n"
            + table(["Counterparty", "Relationship", "Contact person", "Date of check", "Key feedback"], rows, align_right_from=99))


# ── LLM context ──────────────────────────────────────────────────────────────

def _spread_text(ctx: Dict[str, Any]) -> str:
    return spread_table(ctx)


def build_context(ctx: Dict[str, Any]) -> str:
    cm, ar, rm = ctx["cma"], ctx["ar"], ctx["rm"]
    fac = cm["facility"]
    parts = [
        f"BORROWER: {ctx['company']} | SECTOR: {ctx.get('sector') or '—'} | FINANCIAL BASIS: {cm['basis']}",
        f"PROPOSED FACILITY (use exactly): {fac['type'].replace('_', ' ').title()} of ₹{fac['amount_cr']:,.2f} Cr",
        "FACILITY TERMS:\n" + facility_table(ctx),
        "ABOUT (Screener): " + ((ctx.get("about") or "")[:600] or "—"),
        "SCREENER KEY POINTS (borrower STANDALONE page — do not mix with consolidated figures): "
        + " | ".join(ctx.get("key_points") or []),
        "SUMMARY SPREAD (₹ Cr; E = projected):\n" + _spread_text(ctx),
        "PROJECTION & DSCR ASSUMPTIONS:\n" + assumptions_md(ctx),
        "PARAMETER ASSESSMENT (deterministic — use these ratings verbatim):\n" + assessment_table(ctx),
        "COST STRUCTURE:\n" + cost_table(ctx),
        "QUARTERLY RESULTS:\n" + quarter_table(ctx),
        "SHAREHOLDING:\n" + shareholding_table(ctx),
        "SENSITIVITY (first projected year):\n" + sensitivity_table(ctx),
        "COVENANT TESTING:\n" + covenant_test_table(ctx),
    ]
    if fac["is_wc"]:
        parts.append("MPBF:\n" + mpbf_table(ctx))
    else:
        parts.append("PROPOSED TL REPAYMENT & DSCR BY YEAR:\n" + repayment_table(ctx))
    segs = (ctx["deep"] or {}).get("segments") or {}
    if segs:
        parts.append(f"REPORTED SEGMENTS (names only): business {segs.get('business')}, geography {segs.get('geography')}")
    t = (ar or {}).get("topics") or {}
    if t:
        parts.append(f"ANNUAL REPORT {ar.get('fiscal_year') or ''} — extracted facts (cite as 'annual report'):")
        if t.get("business"):
            b = t["business"]
            parts.append("BUSINESS: " + str({k: b.get(k) for k in ("overview", "geography", "plants_and_capacity",
                                                                    "key_customers", "order_book", "capex_plans",
                                                                    "highlights", "risks", "outlook")})[:6000])
            parts.append("SEGMENTS:\n" + segment_table(ctx))
        if t.get("industry"):
            parts.append("INDUSTRY: " + str(t["industry"])[:3500])
        if t.get("ratings"):
            parts.append("CREDIT RATINGS:\n" + ratings_table(ctx))
        if t.get("borrowings"):
            parts.append("BORROWING INSTRUMENTS:\n" + instruments_table(ctx)
                         + f"\nSecurity summary: {t['borrowings'].get('security_summary') or '—'}; notes: "
                         + "; ".join((t['borrowings'].get('notes') or [])[:4]))
        if t.get("contingent"):
            parts.append("CONTINGENT LIABILITIES:\n" + contingent_table(ctx))
        if t.get("related_party"):
            parts.append("RELATED PARTY TRANSACTIONS:\n" + rpt_table(ctx))
        if t.get("auditor"):
            parts.append("AUDITOR:\n" + auditor_md(ctx))
        if t.get("board"):
            parts.append("BOARD:\n" + board_table(ctx))
    else:
        parts.append("ANNUAL REPORT: not analysed — treat business, rating, borrowing and audit details as [RM to provide].")
    g = ctx.get("group") or {}
    if g.get("entities"):
        ents = g["entities"]
        losses = [e for e in ents if (as_number(e.get("pat_cr")) or 0) < 0]
        big = sorted(ents, key=lambda e: -(as_number(e.get("turnover_cr")) or 0))[:8]
        parts.append(f"GROUP STRUCTURE ({'verified by RM' if g.get('verified') else 'auto-extracted, unverified'}): "
                     f"{len(ents)} entities; promoter holding {g.get('promoter_holding_pct')}%. Largest by turnover: "
                     + "; ".join(f"{e['name']} ({e.get('holding_pct')}%, turnover ₹{fa(e.get('turnover_cr'))} Cr, PAT ₹{fa(e.get('pat_cr'))} Cr)" for e in big)
                     + ". Loss-making: " + "; ".join(f"{e['name']} (PAT ₹{fa(e.get('pat_cr'))} Cr)" for e in sorted(losses, key=lambda e: as_number(e.get('pat_cr')) or 0)[:8]))
    sa = standalone_table(ctx)
    if sa:
        parts.append("BORROWER ENTITY STANDALONE:\n" + sa)
    parts.append("RM INPUTS: " + (str(rm)[:5000] if rm else "none provided — use [RM to provide: <item>] where needed"))
    peers = peer_table(ctx["fin"]) if ctx["fin"].get("peers") else ""
    parts.append("PEERS (Screener, latest quarter):\n" + (peers or "not available"))
    if ctx.get("research"):
        parts.append("WEB RESEARCH BRIEF (claims tagged 'from LLM knowledge — verify' are unverified):\n" + ctx["research"][:4500])
    cov = "; ".join(f"{label} {op} {thr:.2f}{unit}" for _k, label, op, thr, unit in COVENANTS) + "; Total Debt/EBITDA <= 3.50x"
    parts.append("STANDARD FINANCIAL COVENANTS: " + cov)
    return "\n\n".join(p for p in parts if p)


RULES = """WRITING RULES (a bank credit committee reads this):
- Analyse, do not describe. For every trend give the figure, the change, the driver and what it means for repayment.
- Cite figures exactly as they appear in the context tables (₹ Cr, Indian grouping, whole crore from ₹100 Cr).
- Use short paragraphs and bullet points; bold the conclusion of each paragraph.
- Never restate a table that is already shown — interpret it.
- Use the deterministic Assessment ratings verbatim; never invent another rating.
- Where information is not in the context, write "[RM to provide: <what>]" — never guess names, amounts, ratings,
  customers, lenders or events. Statements tagged "(from LLM knowledge — verify)" are unverified: do not use them as facts.
- Equity-market metrics (share price, P/E, valuation) are not credit factors.
- The PURPOSE / END-USE of the facility is unknown unless FACILITY TERMS state it: write "[RM to provide: purpose]".
  Never write capex, growth plans, general corporate purposes or any other purpose on your own.
- Account conduct, CIBIL/CRILC status, defaults and wilful-defaulter status come ONLY from RM INPUTS or from the
  auditor's CARO confirmations (cite them as "per the statutory auditor's CARO report"); otherwise write
  "[RM to provide: ...]". Never state on your own that conduct is satisfactory or that there is no default history.
- Zero amounts are "nil" in prose, never "₹0.0 Cr".
- The current ratio is APPROXIMATE (Screener's classification of current items): describe it as "tight on an
  approximate classification, to be verified from the audited balance sheet" — never as a covenant breach.
- Annual-report notes are often in ₹ million: convert to ₹ crore (divide by 10) before quoting.
- Growth figures: YoY compares with the immediately previous year in the spread; quote that year's figure.
- Measured language: no absolutes such as "minimal risk", "fully supported", "seamless", "unassailable";
  state the cushion with numbers instead.
- Never repeat these instructions or name context blocks (e.g. "SUMMARY SPREAD") in the text.
- No headings unless the section instruction asks for them."""

PROMPTS: Dict[str, str] = {
    "proposed_structure": "Current proposal (120-200 words): what is proposed and why, structure, repayment source, security, "
                          "pricing basis; then 3-5 bullets of actionables / conditions the RM must close before sanction.",
    "business_profile": "Company & business profile (300-450 words, bullets welcome): incorporation & vintage, products and "
                        "segments with revenue figures, geography and export share, plants/capacity, key customers and "
                        "industries served, supply side / raw materials, recent developments (acquisitions, restructuring, "
                        "new businesses) and their credit relevance. Mark customer/supplier concentration as [RM to provide] "
                        "if not in the context.",
    "group_organogram": "Group structure commentary (180-280 words): ownership chain (promoter holding %), number and type of "
                        "entities, the material subsidiaries by turnover and their profitability, loss-making entities and the "
                        "support the borrower extends to them (guarantees, loans, investments from related-party data), "
                        "contribution of overseas operations, and whether the structure needs RM verification.",
    "promoter_background": "Management evaluation (200-300 words): promoters and their track record, board composition "
                           "(executive / independent mix from the board data), shareholding trend and what it signals, "
                           "KMP remuneration if material, governance observations from the auditor data.",
    "industry_analysis": "Industry outlook (250-380 words, bullets): demand drivers by end market, current cycle position, "
                         "export markets and trade-policy exposure, input cost dynamics, regulatory/policy factors, "
                         "competitive landscape, and the specific impact on this borrower. Cite figures from the annual "
                         "report industry discussion and research.",
    "financial_analysis": "Overall financial commentary (200-300 words): the 5-year story in four bullets (scale, margins, "
                          "leverage, cash generation), the quality of earnings (exceptional items, other income), and the key "
                          "takeaway for this proposal. Do not repeat the spread table.",
    "sales_profitability": "Revenue & profitability analysis (300-420 words). Two sub-parts with bold labels "
                           "'Sales' and 'Profitability': YoY and CAGR growth, drivers by segment/geography, quarter trend; "
                           "EBITDA margin trend explained through the cost structure (material, manufacturing, employee, "
                           "other), PAT movement including exceptional items and tax, and sustainability of margins.",
    "leverage_debt": "Leverage, debt profile & debt servicing (300-420 words): debt composition (term vs working capital, "
                     "instruments, pricing, rating-linked triggers), leverage trend (Debt/EBITDA, TOL/TNW), coverage (ICR, "
                     "DSCR and its basis), covenant compliance, the impact of the proposed facility, and refinancing / "
                     "maturity concentration risk.",
    "working_capital_analysis": "Liquidity & working capital analysis (250-380 words): current ratio and its trend, "
                                "inventory/debtor/creditor days and cash conversion cycle with drivers, working-capital "
                                "funding (bank lines vs internal accruals), operating and free cash flow track record, "
                                "and liquidity buffers (cash). Note the approximate classification of current items.",
    "interim_performance": "Interim performance (150-250 words): latest quarter vs same quarter last year and vs previous "
                           "quarter — sales, EBITDA margin, PAT, other income / exceptional items — and whether the run-rate "
                           "supports the annual projections.",
    "facility_assessment": "Assessment of the facility (200-320 words): for a term loan — repayment capacity from the "
                           "year-wise DSCR table, cushion over 1.25x, the sensitivity results and the break-point risks; "
                           "for working capital — MPBF / drawing-power logic and headroom. State clearly whether the "
                           "proposed amount and structure are supported.",
    "banking_arrangement": "Banking arrangement commentary (150-250 words): external ratings and what they imply, the "
                           "borrowing mix (term vs working capital, secured vs unsecured, domestic vs foreign currency), "
                           "existing lenders (RM inputs only, else [RM to provide]), account conduct and CIBIL/CRILC status "
                           "(RM inputs only, else [RM to provide]) and system exposure after the proposal.",
    "contingent_rpt": "Commentary (200-300 words): size of contingent liabilities relative to net worth and the nature of the "
                      "material items, related-party exposures (guarantees/loans to group entities) and their risk, and the "
                      "auditor's observations (opinion, key audit matters, CARO remarks) with their credit implication.",
    "peer_comparison": "Peer comparison (120-200 words) using only the peer table figures: scale, growth, profitability "
                       "(ROCE, PAT margin) and the borrower's relative position. Do not discuss valuation.",
    "due_diligence": "Adverse information summary (80-150 words): what the web research found on litigation, regulatory "
                     "action, defaults or governance (only verified items), and which checks remain pending with the RM.",
    "risk_summary": "Key risks & mitigants. Output ONLY a markdown table with header | Key risk | Mitigant | and 6-8 rows. "
                    "Each risk: bold title + 1-2 sentences with figures. Each mitigant: specific, grounded in the data or "
                    "a covenant/condition — never generic.",
    "recommendation": "Recommendation (250-380 words): the decision (approve / approve with conditions / decline) — "
                      "while any pre-sanction information is still [RM to provide], the decision must read 'Approve, "
                      "subject to the conditions below' — and the "
                      "rationale in 4-6 bullets (strengths) and 3-4 bullets (concerns and how they are addressed); then "
                      "'**Conditions precedent:**' as bullets and '**Pre-disbursement information pending:**' as bullets "
                      "drawn from the [RM to provide] items. Do not write the covenant tables (they are appended).",
    "executive_summary": "Executive summary (280-380 words): the proposal; the borrower and group in two sentences; the "
                         "financial profile with the key figures (sales, EBITDA margin, PAT, net worth, Debt/EBITDA, DSCR); "
                         "external rating; top 3 strengths and top 3 risks as bullets; the recommendation in one bold line.",
}

_DELIM = "###SECTION:"


def _parse(raw: str, keys: List[str]) -> Dict[str, str]:
    parts = re.split(r"###SECTION:(\w+)###", raw or "")
    out = {}
    for i in range(1, len(parts) - 1, 2):
        k, body = parts[i].strip(), parts[i + 1].strip()
        if k in keys and body:
            out[k] = body
    return out


def _draft(llm, context: str, company: str, keys: List[str]) -> Dict[str, str]:
    spec = "\n".join(f"{_DELIM}{k}###\n{PROMPTS[k]}" for k in keys)
    prompt = (f"{context}\n\n---\nYou are a senior credit analyst at an Indian bank writing the Credit Appraisal "
              f"Memorandum for \"{company}\". Write each section below; start each with its delimiter exactly as shown.\n\n"
              f"{spec}\n\n{RULES}")
    out = _parse(llm(prompt), keys)
    missing = [k for k in keys if k not in out]
    for k in missing:  # one retry per missing section, singly
        single = _parse(llm(f"{context}\n\n---\nWrite only this section for \"{company}\":\n{_DELIM}{k}###\n"
                            f"{PROMPTS[k]}\n\n{RULES}"), [k])
        out.update(single)
    return out


# ── assembly ─────────────────────────────────────────────────────────────────

def compose(ctx: Dict[str, Any], prose: Dict[str, str]) -> Dict[str, str]:
    """Final markdown per section: deterministic parts around the LLM prose."""
    P = lambda k: prose.get(k, "")  # noqa: E731
    cm, ar = ctx["cma"], ctx["ar"]
    basis_src = src(f"Screener.in {cm['basis'].lower()} statements; CreditGuard computations. Verify against audited accounts.")
    ar_src = src(f"Annual report {ar.get('fiscal_year') or ''} (BSE filing){', pages ' + ', '.join(str(p) for p in sorted({p for v in (ar.get('pages_used') or {}).values() for p in v})[:12]) if ar.get('pages_used') else ''}.") if ar.get("topics") else ""
    g = ctx.get("group") or {}
    org_note = ("_Structure confirmed by the RM._" if g.get("verified") else
                "_Auto-extracted from the annual report (Form AOC-1); **RM to verify** in the Data Room before sanction._")
    is_wc = cm["facility"]["is_wc"]
    s = {
        "executive_summary": [snapshot_table(ctx), P("executive_summary")],
        "proposed_structure": ["**Facility terms**", facility_table(ctx), "**Current proposal**", P("proposed_structure")],
        "business_profile": [P("business_profile"),
                             ("**Segment / business-wise performance (annual report)**\n\n" + segment_table(ctx)) if segment_table(ctx) else "",
                             ("**Top customers (RM)**\n\n" + counterparties_table(_rm(ctx["rm"], "customers"), "customers")) if _rm(ctx["rm"], "customers") else
                             "**Top customers:** [RM to provide: top 10 customers with share of sales]",
                             ("**Top suppliers (RM)**\n\n" + counterparties_table(_rm(ctx["rm"], "suppliers"), "suppliers")) if _rm(ctx["rm"], "suppliers") else
                             "**Top suppliers:** [RM to provide: top 10 suppliers with share of purchases]", ar_src],
        "group_organogram": [og.md_block(g) if g.get("entities") else "_Group structure not available — upload an organogram or enter the structure in the Data Room._",
                             org_note, P("group_organogram"),
                             ("**Group entities**\n\n" + entity_table(ctx)) if g.get("entities") else "",
                             ("**Borrower entity — standalone headline financials**\n\n" + standalone_table(ctx)) if standalone_table(ctx) else "",
                             ar_src],
        "promoter_background": ["**Shareholding pattern (quarterly)**", shareholding_table(ctx),
                                ("**Board of directors**\n\n" + board_table(ctx)) if board_table(ctx) else "**Board of directors:** [RM to provide]",
                                "**Management evaluation**", P("promoter_background"),
                                "**Regulatory checks on directors**", regulatory_checks_table(ctx)],
        "industry_analysis": [P("industry_analysis"), ar_src],
        "financial_analysis": ["**Basis and key assumptions**", assumptions_md(ctx),
                               f"**Summary financials — {cm['basis']} (₹ Cr)**", spread_table(ctx),
                               "**Parameter assessment**", assessment_table(ctx),
                               format_scorecard_md(ctx["scorecard"]) if ctx.get("scorecard") else "",
                               "**Commentary**", P("financial_analysis"), basis_src],
        "sales_profitability": [rating_line(ctx, "sales", "Sales"), rating_line(ctx, "profitability", "Profitability"),
                                "**Cost structure (% of sales)**", cost_table(ctx), P("sales_profitability"), basis_src],
        "leverage_debt": [rating_line(ctx, "leverage", "Leverage & debt servicing"), "**Debt profile and coverage**", debt_table(ctx),
                          ("**Borrowing instruments (annual report)**\n\n" + instruments_table(ctx)) if instruments_table(ctx) else "",
                          "**Financial covenant testing (latest year)**", covenant_test_table(ctx), P("leverage_debt"), basis_src],
        "working_capital_analysis": [rating_line(ctx, "liquidity", "Liquidity"), "**Current assets, liabilities and holding levels**",
                                     liquidity_table(ctx), "**Cash flow**", cashflow_table(ctx), P("working_capital_analysis"),
                                     src("Screener.in schedules; current items are approximate (Screener classification).")],
        "interim_performance": [quarter_table(ctx), P("interim_performance"), src("Screener.in quarterly results.")],
        "facility_assessment": [("**Working-capital assessment (MPBF)**\n\n" + mpbf_table(ctx)) if is_wc else
                                "**Repayment schedule and debt-service coverage (projected)**\n\n" + repayment_table(ctx),
                                "**Sensitivity analysis**", sensitivity_table(ctx), P("facility_assessment")],
        "banking_arrangement": [("**External credit ratings (annual report)**\n\n" + ratings_table(ctx)) if ratings_table(ctx) else
                                "**External credit ratings:** [RM to provide]", "**Existing banking arrangement**", lenders_table(ctx),
                                P("banking_arrangement")],
        "contingent_rpt": [("**Contingent liabilities**\n\n" + contingent_table(ctx)) if contingent_table(ctx) else "**Contingent liabilities:** [RM to provide]",
                           ("**Related-party transactions (largest)**\n\n" + rpt_table(ctx)) if rpt_table(ctx) else "",
                           ("**Statutory auditor's observations**\n\n" + auditor_md(ctx)) if auditor_md(ctx) else "",
                           "**Commentary**", P("contingent_rpt"), ar_src],
        "peer_comparison": [peer_table(ctx["fin"]) or "_Peer data not available — add listed peers in the Data Room._",
                            src("Screener.in peer comparison, latest reported quarter (Screener's default basis for each company; "
                                "may differ from the consolidated spread used elsewhere)."), P("peer_comparison")],
        "due_diligence": [due_diligence_table(ctx), "**Adverse information**", P("due_diligence")],
        "risk_summary": [P("risk_summary")],
        "recommendation": [P("recommendation"), "**Financial covenants**", financial_covenants_table(),
                           "**General covenants**", general_covenants_table(ctx)],
        "ews_checklist": [format_ews_checklist_md()],
        "reference_check": [reference_md(ctx)],
        "information_required": [info_required_md(ctx)],
    }
    return {k: to_crore_text("\n\n".join(x for x in parts if x and str(x).strip())) for k, parts in s.items()}


def summary(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Headline figures, provenance and open items for the case workspace UI.
    Same numbers as the memo (one source: cma.py)."""
    cm, ar, deep = ctx["cma"], ctx["ar"], ctx["deep"] or {}
    a = (cm.get("actuals") or [{}])[-1]
    asmt = cm.get("assessment") or {}
    sc = ctx.get("scorecard") or {}
    sources = []
    if deep.get("years"):
        sources.append({"label": f"Screener.in — {cm['basis'].lower()} statements, {len(deep['years'])} years"
                                 + (f" + {len(((deep.get('quarters') or {}).get('periods') or [])[-5:])} quarters" if deep.get('quarters') else ""),
                        "url": deep.get("url")})
    if ar.get("topics"):
        pages = sorted({p for v in (ar.get("pages_used") or {}).values() for p in v})
        sources.append({"label": f"Annual report {ar.get('fiscal_year') or ''} (BSE filing)"
                                 + (f" — pp. {', '.join(str(p) for p in pages[:8])}" if pages else ""),
                        "url": ar.get("source_url")})
    if ctx.get("research"):
        sources.append({"label": "Web research brief", "url": None})
    if ctx["fin"].get("peers"):
        sources.append({"label": "Screener.in peer comparison (latest quarter)", "url": None})
    return {
        "basis": cm["basis"],
        "year": _fy(a.get("year")),
        "metrics": {k: a.get(k) for k in ("sales", "sales_growth", "ebitda_margin", "pat", "net_worth", "total_debt",
                                          "debt_ebitda", "tol_tnw", "dscr", "icr", "current_ratio")},
        "ebitda_margin_avg3": round(sum(x["ebitda_margin"] for x in (cm.get("actuals") or [])[-3:] if x.get("ebitda_margin") is not None)
                                    / max(1, len([x for x in (cm.get("actuals") or [])[-3:] if x.get("ebitda_margin") is not None])), 1)
                              if cm.get("actuals") else None,
        "rating": rating_summary(ar) or None,
        "grade": sc.get("grade") if sc.get("rated") else None,
        "grade_score": sc.get("score") if sc.get("rated") else None,
        "assessment": {k: v.get("rating") for k, v in asmt.items()},
        "facility": cm["facility"],
        "sources": sources,
        "group_entities": len((ctx.get("group") or {}).get("entities") or []),
        "group_verified": bool((ctx.get("group") or {}).get("verified")),
    }


def build_ctx(financials: Dict[str, Any], company: str, research: str, rm: Dict[str, Any],
              ar: Dict[str, Any], group: Dict[str, Any], sector: str = "") -> Dict[str, Any]:
    deep = financials.get("deep") or {}
    cm = cma_mod.build(deep, financials.get("facility") or {}, rm)
    ratios = cma_mod.ratios_view(cm)
    ci = financials.get("company_info") or {}
    ctx = {
        "company": company, "sector": sector or ci.get("industry"), "fin": financials, "deep": deep,
        "cma": cm, "ratios": ratios, "rm": rm or {}, "ar": ar or {}, "group": group or {},
        "research": research or "", "about": ci.get("about"), "key_points": ci.get("key_points") or [],
    }
    try:
        sc = compute_scorecard(financials, ratios)
        ctx["scorecard"] = sc
        ctx["grade"] = f"{sc.get('grade')} ({sc.get('score')}/100)" if sc.get("rated") else "Unrated"
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[CAMv2] scorecard failed: {e}")
    return ctx


def _alternates(cm: Dict[str, Any]) -> Dict[str, list]:
    rows = _years(cm)
    pick = lambda k: [r.get(k) for r in rows if r.get(k) is not None]  # noqa: E731
    alt = {"dscr": pick("dscr") + [s["dscr"] for s in cm.get("sensitivity") or [] if s.get("dscr") is not None],
           "debt_equity": pick("debt_equity"), "interest_coverage": pick("icr") +
           [s["icr"] for s in cm.get("sensitivity") or [] if s.get("icr") is not None],
           "current_ratio": pick("current_ratio"), "net_margin": pick("pat_margin"),
           "ebitda_margin": pick("ebitda_margin"), "roce": pick("roce")}
    return alt


def generate(financials: Dict[str, Any], company: str, research: str = "", rm: Dict[str, Any] = None,
             ar: Dict[str, Any] = None, group: Dict[str, Any] = None, llm=None, sector: str = "",
             only: Optional[str] = None) -> Dict[str, Any]:
    """All sections (or `only` one). Returns {key: section dict} + _risk_flags / _credit_rating."""
    from risk_flags import generate_risk_flags
    ctx = build_ctx(financials, company, research, rm or {}, ar or {}, group or {}, sector)
    context = build_context(ctx)
    llm_keys = [k for k, _t, uses in SECTIONS if uses and k != "executive_summary"]
    if only:
        llm_keys = [only] if only in llm_keys else []
    groups = [llm_keys[i:i + 3] for i in range(0, len(llm_keys), 3)]
    prose: Dict[str, str] = {}
    if groups and llm:
        with ThreadPoolExecutor(max_workers=min(6, len(groups))) as pool:
            futs = [pool.submit(_draft, llm, context, company, g) for g in groups]
            for f in as_completed(futs):
                try:
                    prose.update(f.result())
                except Exception as e:  # noqa: BLE001
                    logger.error(f"[CAMv2] batch failed: {e}")
    if llm and (only in (None, "executive_summary")):
        digest = "\n\n".join(f"[{k}]\n{prose.get(k, '')[:700]}" for k in ("financial_analysis", "leverage_debt",
                                                                          "facility_assessment", "risk_summary", "recommendation"))
        prose.update(_draft(llm, context + "\n\n--- SECTION DRAFTS ---\n" + digest, company, ["executive_summary"]))

    composed = compose(ctx, prose)
    fac_cr = ctx["cma"]["facility"]["amount_cr"]
    out: Dict[str, Any] = {}
    keys = [only] if only else [k for k, _t, _u in SECTIONS]
    for k in keys:
        content = scrub_assurances(strip_rupee_restatements(composed.get(k, "")),
                                   bool(_rm(ctx["rm"], "conduct", "account_conduct")))
        conf, reason = CONFIDENCE.get(k, ("medium", ""))
        uses_llm = next((u for kk, _t, u in SECTIONS if kk == k), False)
        if uses_llm and llm and not prose.get(k):
            conf, reason = "low", "Commentary could not be drafted — regenerate this section"
        # This CAM discusses the company's own limits and repayments at length; only
        # amounts in a sentence about the PROPOSED facility can be mis-scaled copies.
        issues = [i for i in (audit_facility_amounts(prose.get(k, ""), fac_cr) if uses_llm else [])
                  if re.search(r"propos|this facility|the facility|this loan|the loan", i.get("excerpt", ""), re.I)
                  and not re.search(r"existing|sanctioned|limit|total|system|aggregate|consolidated|"
                                    r"capex|capital expenditure|plant|manufactur|factory|capacity|acqui|invest",
                                    i.get("excerpt", ""), re.I)]
        if issues:
            content += ("\n\n**Automated check:** this section cites "
                        + ", ".join(f"₹{i['stated_cr']:,.2f} Cr" for i in issues)
                        + f" in connection with the facility, but the proposed facility is ₹{fac_cr:,.2f} Cr.")
            conf = "low"
        out[k] = {"content": content, "title": TITLES[k], "ai_generated": uses_llm, "confidence": conf,
                  "confidence_reason": reason, "drafted": bool(prose.get(k)) or not uses_llm}
    if not only:
        # Peer and industry text quote other companies' ratios (e.g. a peer's ROCE).
        combined = "\n".join(v for k, v in prose.items() if k not in ("peer_comparison", "industry_analysis"))
        mism = audit_memo_figures(combined, ctx["ratios"], _alternates(ctx["cma"]))
        if mism and "risk_summary" in out:
            out["risk_summary"]["content"] += "\n\n**Figure verification (automated):**\n\n" + bullets(
                [f"{m['label'].upper()}: text states {m['stated']}, computed {m['computed']} — reconcile." for m in mism])
        a = ctx["cma"]["actuals"]
        legacy = {"profit_loss": {"revenue": [x["sales"] for x in a], "pat": [x["pat"] for x in a]}}
        out["_risk_flags"] = generate_risk_flags(ctx["ratios"], legacy)
        out["_credit_rating"] = ctx.get("scorecard") or {}
        out["_info_requests"] = [{"priority": p, "item": i, "why": w} for p, i, w in info_requests(ctx)]
        out["_section_order"] = [{"key": k, "title": t} for k, t, _u in SECTIONS]
        out["_summary"] = summary(ctx)
    return out
