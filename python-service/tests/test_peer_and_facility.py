"""Regressions from 2026-10-11: invented peer figures and a mis-scaled facility."""
from cam_tables import peer_table
from cam_sections import _build_context_text, _with_peer_table

PEERS = [
    {"name": "Infosys", "confirmed": True,
     "screenerData": {"market_cap_cr": 415324.02, "pe": 13.32, "roce_pct": 39.95,
                      "sales_qtr_cr": 48211.0, "sales_qtr_var_pct": 14.03, "np_qtr_cr": 7775.0}},
    {"name": "Unticked Co", "confirmed": False, "screenerData": {"market_cap_cr": 1}},
    {"name": "Manual Peer", "confirmed": True},
]


def test_peer_table_uses_only_supplied_figures():
    fin = {"company_info": {"name": "TCS"}, "peers": PEERS,
           "peer_self_metrics": {"market_cap_cr": 780059.67, "sales_qtr_cr": 60441.0, "np_qtr_cr": 14104.0}}
    t = peer_table(fin)
    assert "| **TCS** | 7,80,060 |" in t
    assert "| Infosys | 4,15,324 | 13.3 | 40.0 | 48,211 | 14.0 | 7,775 | 16.1 |" in t
    assert "Unticked Co" not in t                       # RM unticked it
    assert "| Manual Peer | — | — | — | — | — | — | — |" in t  # never filled in


def test_no_peers_says_so_instead_of_inventing():
    out = _with_peer_table("narrative", {"peers": []})
    assert out.startswith("_Peer data not available")
    assert "PEER DATA" not in _build_context_text({}, {}, "X", "")


def test_facility_line_is_exact_and_in_crore():
    ctx = _build_context_text({"facility": {"type": "term_loan", "amount_inr": 10_000_000}}, {}, "X", "")
    assert "Term Loan of ₹1.00 Cr." in ctx
    assert "(₹" not in ctx.split("PROPOSED FACILITY")[1].split("\n")[0]  # no rupee restatement to mis-copy


def test_facility_scale_guard():
    from validators import audit_facility_amounts, strip_rupee_restatements
    assert strip_rupee_restatements("a Term Loan of ₹1.00 Cr (₹1,00,000,000) to TCS") == "a Term Loan of ₹1.00 Cr to TCS"
    bad = "tenor of 5 years with annual principal repayments assumed at ₹100 Cr (or apportioned)"
    assert audit_facility_amounts(bad, 1.0)[0]["stated_cr"] == 100.0
    ok = "revenue grew to ₹2,20,938 Cr in FY26. The term loan of ₹1.00 Cr is repayable in 20 instalments."
    assert audit_facility_amounts(ok, 1.0) == []
    accruals = "debt service installments out of internal accruals, supported by operating cash flows of ₹45,597.00 Cr"
    assert audit_facility_amounts(accruals, 1.0) == []


def test_projections_use_the_case_facility_not_a_hardcoded_500cr_loan():
    fin = {
        "facility": {"type": "term_loan", "amount_inr": 10_000_000},
        "profit_loss": {"years": ["Mar 2024", "Mar 2025"], "revenue": [100.0, 110.0], "ebitda": [20.0, 22.0],
                        "pat": [10.0, 11.0], "depreciation": [2.0, 2.0], "interest": [1.0, 1.0]},
        "balance_sheet": {"total_assets": [80.0, 90.0], "total_equity": [50.0, 55.0],
                          "fixed_assets": [30.0, 32.0], "borrowings": [10.0, 9.0]},
    }
    ctx = _build_context_text(fin, {}, "X", "")
    assert "₹500 Cr" not in ctx and "₹100 Cr" not in ctx
    assert "₹1.00 Cr repaid over 5 years (₹0.20 Cr/yr" in ctx
