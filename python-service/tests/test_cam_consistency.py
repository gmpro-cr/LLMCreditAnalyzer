"""Regressions from the Bharat Forge live review (2026-10-11): the CAM printed
DSCR 6-7x in the narrative and 1.01x "Breach" in the covenant table."""
import json
import pathlib

from cam_sections import _build_context_text, _strip_dp_table, _reported_alternates
from cam_tables import ratio_covenant_table
from finance_utils import dscr
from ratios import calculate_ratios
from validators import audit_memo_figures

FIN = {
    "source": "screener",
    "profit_loss": {
        "years": ["Mar 2024", "Mar 2025", "Mar 2026"],
        "revenue": [8969, 8844, 8396], "ebitda": [2478, 2504, 2307],
        "pbt": [1895, 1819, 1271], "pat": [1425, 1322, 819],
        "interest": [287, 250, 182], "depreciation": [442, 440, 448],
        "other_income": [147, 5, -405],
        "revenue_from_operations": {"current": 8396}, "profit_after_tax": {"current": 819},
        "finance_costs": {"current": 182}, "depreciation_amortization": {"current": 448},
    },
    "balance_sheet": {
        "years": ["Mar 2024", "Mar 2025", "Mar 2026"],
        "borrowings": [4756, 4296, 4060], "total_equity": [8569, 10965, 10989],
        "total_assets": [15188, 17260, 17528], "fixed_assets": [3157, 3129, 3116],
        "equity": {"total_equity": 10989},
        "assets": {"total_assets": 17528},
        "liabilities": {"non_current_liabilities": {"long_term_borrowings": 4060}},
    },
    "key_ratios_from_screener": {"debtor_days": 180, "inventory_days": 177, "payable_days": 158,
                                 "working_capital_days": 53},
    "facility": {"type": "term_loan", "amount_inr": 2_500_000_000},
}


def test_screener_pl_is_read_so_icr_and_dscr_are_real():
    r = calculate_ratios(FIN)
    assert r["interest_coverage"] == 12.68            # EBITDA / interest, not N/A
    assert r["debtor_days"] == 180                     # Screener day counts feed risk flags
    # (819 + 448 + 182) / (182 + 4060/5 + 250/5)
    assert r["dscr"] == dscr(819, 448, 182, 4060, 50.0) == 1.39


def test_one_dscr_basis_across_ratios_cma_and_covenant_table():
    r = calculate_ratios(FIN)
    ctx = _build_context_text(FIN, r, "BFL", "")
    cma_row = next(l for l in ctx.splitlines() if l.startswith("DSCR (pro forma, est.)"))
    assert cma_row.split()[-1] == "1.39"
    assert "1.39x (pro forma, est.)" in ratio_covenant_table(r)
    assert "Interest Coverage | 12.68x" in ratio_covenant_table(r)


def test_projection_labels_and_wc_cycle():
    ctx = _build_context_text(FIN, calculate_ratios(FIN), "BFL", "")
    assert "P1 (FY2027E)" in ctx and "Ma27E" not in ctx
    assert "working_capital_days" not in ctx           # different basis; model mis-combined it
    assert "cash_conversion_cycle_days (inventory 177 + debtor 180 - creditor 158): 199" in ctx
    assert "Other Income (incl. exceptional)" in ctx
    assert "STRESS TEST" in ctx and "Debt/Equity <= 2.00x" in ctx


def test_dp_table_stripped_but_prose_kept():
    md = ("Term loan of ₹250.00 Cr.\n\n| Item | Amount (₹ Cr) |\n|---|---|\n"
          "| **Drawing Power (min of Bank Financing & Limit)** | x |\n\nSecurity: first charge.")
    out = _strip_dp_table(md)
    assert "Drawing Power" not in out and "Security: first charge." in out


def test_figure_audit_accepts_earlier_years():
    r = calculate_ratios(FIN)
    alt = _reported_alternates(FIN, r)
    text = "Debt/Equity improved from 0.56x to 0.37x."
    assert audit_memo_figures(text, r) and not audit_memo_figures(text, r, alt)
    assert audit_memo_figures("Debt/Equity of 1.90x", r, alt)   # genuinely wrong still flagged


def test_audit_accepts_projected_and_stress_dscr():
    r = calculate_ratios(FIN)
    ctx = _build_context_text(FIN, r, "BFL", "")
    alt = _reported_alternates(FIN, r, ctx)
    assert not audit_memo_figures("projected DSCR of 1.76x in FY2027E", r, alt)


def test_one_flag_per_ratio_and_pat_decline_flagged():
    from risk_flags import generate_risk_flags
    flags = generate_risk_flags(calculate_ratios(FIN), FIN)
    titles = [f["title"] for f in flags]
    assert titles.count("High Debtor Days") == 1 and "Elevated Debtor Days" not in titles
    assert any(f["title"] == "Profit Decline" and f["severity"] == "high" for f in flags)


def test_aggregate_exposure_is_not_a_facility_amount():
    from validators import audit_facility_amounts
    txt = ("existing borrowings of ₹4,060 Cr plus the proposed Term Loan facility of ₹250.00 Cr, "
           "bringing the aggregate debt exposure to ₹4,310 Cr.")
    assert audit_facility_amounts(txt, 250.0) == []


def test_amounts_whole_crore_in_context():
    ctx = _build_context_text(FIN, calculate_ratios(FIN), "BFL", "")
    assert "8,969.00" not in ctx and "8,969" in ctx
    assert "Current Ratio >= 1.33x (not computable" in ctx


def test_audit_skips_percentage_point_changes():
    r = calculate_ratios(FIN)
    assert not audit_memo_figures("an EBITDA margin drop of -5 pp is severe. The EBITDA margin of 27.5% held", r)


def test_rating_line_is_data_only():
    fin = {**FIN, "company_info": {"credit_ratings": ["Rating update | 22 Sep from icra | 19 Dec 2025 from care"]}}
    ctx = _build_context_text(fin, {}, "BFL", "")
    line = next(l for l in ctx.splitlines() if l.startswith("CREDIT RATING ACTIONS"))
    assert "ICRA: rating update 22 Sep" in line and "never" not in line
