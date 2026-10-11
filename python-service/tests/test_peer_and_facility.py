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
    assert "Term Loan of ₹1.00 Cr (₹1,00,00,000)" in ctx
