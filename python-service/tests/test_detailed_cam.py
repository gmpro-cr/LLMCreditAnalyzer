"""Detailed CAM (v2): CMA engine, annual-report helpers, organogram and composer."""
import json

import annual_report as ar
import cam_v2
import cma
import organogram as og

YEARS = ["Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025", "Mar 2026"]
DEEP = {
    "basis": "Consolidated", "years": YEARS,
    "rows": {
        "sales": [1000, 1100, 1200, 1300, 1400], "ebitda": [150, 160, 180, 200, 210],
        "opm_pct": [15, 15, 15, 15, 15], "other_income": [10, 10, 10, 10, -20], "exceptional_items": [0, 0, 0, 0, -30],
        "interest": [20, 22, 24, 25, 26], "depreciation": [40, 42, 44, 46, 48], "pbt": [100, 106, 122, 139, 116],
        "tax_pct": [25, 25, 25, 25, 25], "pat": [75, 80, 92, 104, 87], "dividend_payout_pct": [20, 20, 20, 20, 20],
        "equity_capital": [10] * 5, "reserves": [490, 560, 640, 730, 800], "borrowings": [300, 320, 330, 340, 350],
        "lt_borrowings": [150, 160, 160, 170, 180], "lease_liabilities": [10] * 5, "st_borrowings": [140, 150, 160, 160, 160],
        "trade_payables": [80, 85, 90, 95, 100], "advance_from_customers": [0] * 5, "other_liability_items": [40] * 5,
        "total_assets": [920, 1015, 1110, 1215, 1300], "net_block": [400, 420, 440, 460, 480],
        "inventories": [150, 160, 170, 180, 190], "receivables": [160, 170, 180, 190, 200], "cash": [30] * 5,
        "loans_advances": [10] * 5, "other_asset_items": [20] * 5,
        "cfo": [60, 70, 80, 90, 100], "capex_fixed_assets": [-50, -50, -60, -60, -70],
        "debtor_days": [58, 56, 55, 53, 52], "inventory_days": [60] * 5, "payable_days": [30] * 5,
        "cash_conversion_cycle": [88, 86, 85, 83, 82], "roce_pct": [14, 14, 15, 15, 14],
    },
    "quarters": {"periods": ["Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026"],
                 "rows": {"sales": [330, 340, 360, 370, 350], "pat": [20, 21, 23, 23, -5]}},
    "shareholding": {"periods": ["Jun 2026"], "rows": {"Promoters": [55.0]}},
}
FAC = {"type": "term_loan", "amount_inr": 500_000_000}  # ₹50 Cr


def test_cma_dscr_uses_term_debt_only_and_projects_tenor():
    c = cma.build(DEEP, FAC)
    last = c["actuals"][-1]
    # (87 + 48 + 26) / (26 + (180 + 10) / 5 + 50 / 5)
    assert last["dscr"] == round(161 / (26 + 38 + 10), 2)
    assert last["current_ratio"] == round(450 / 300, 2)
    p = c["projections"]["rows"]
    assert len(p) == 5 and p[0]["year"] == "FY2027E" and p[-1]["tl_closing"] == 0.0
    assert p[0]["debt_equity"] < 1  # net worth carried from equity + reserves
    assert all(r["principal_tl"] == 10.0 for r in p)
    assert c["assessment"]["sales"]["rating"] in ("Strong", "Moderate")
    assert c["sensitivity"][0]["scenario"] == "Base case" and len(c["sensitivity"]) == 7


def test_cma_wc_facility_gets_mpbf_not_repayment():
    c = cma.build(DEEP, {"type": "cash_credit", "amount_inr": 200_000_000})
    assert c["facility"]["is_wc"] and c["mpbf"]["mpbf"] == round((450 - 140) - 0.25 * 450, 1)
    assert all(r["principal_tl"] == 0 for r in c["projections"]["rows"])


def test_rm_tenor_and_moratorium_drive_schedule():
    c = cma.build(DEEP, FAC, {"proposal": {"tenor_months": 48, "moratorium_months": 12}})
    p = c["projections"]["rows"]
    assert len(p) == 4 and p[0]["principal_tl"] == 0 and abs(p[1]["principal_tl"] - 50 / 3) < 0.05


def test_to_crore_and_group_structure():
    assert ar.to_crore("1,728.9", "Million") == 172.89 and ar.to_crore(5, "lakhs") == 0.05
    assert ar.to_crore(10, "furlongs") is None  # unknown unit is never guessed
    res = {"topics": {"group": {"entities": [
        {"name": "A GmbH", "relation": "Subsidiary", "holding_pct": 100, "turnover_cr": 10},
        {"name": "A GmbH", "relation": "subsidiary"},
        {"name": "B Pvt Ltd", "relation": "Joint Venture", "holding_pct": 50}]}}, "pages_used": {"group": [5]}}
    gs = ar.group_structure_from(res, "Co Ltd", 51.2)
    assert [e["name"] for e in gs["entities"]] == ["A GmbH", "B Pvt Ltd"] and gs["verified"] is False


def test_select_pages_prefers_distinct_keyword_hits():
    texts = ["Contingent liabilities are defined as...", "x", "Contingent liabilities In Million claims not acknowledged as debts GST"]
    assert ar.select_pages(texts, ar.TOPICS["contingent"][0], 2) == [2]


def test_organogram_regions_layout_and_block():
    gs = {"borrower": "Co Ltd", "promoter_group": "Promoters", "promoter_holding_pct": 51.2, "entities": [
        {"name": "Alpha India Private Limited", "relation": "subsidiary", "holding_pct": 100},
        {"name": "Beta GmbH", "relation": "subsidiary", "holding_pct": 100},
        {"name": "Gamma SAS", "relation": "subsidiary", "currency": "EUR"},
        {"name": "Delta Ltd (formerly Old Name Ltd)", "relation": "associate", "holding_pct": 26}]}
    data = og.compact(gs)
    cols = {c["key"]: [i["n"] for i in c["items"]] for c in data["columns"]}
    assert cols["sub_india"] == ["Alpha India Private Limited"]
    assert sorted(cols["sub_overseas"]) == ["Beta GmbH", "Gamma SAS"] and cols["jv_assoc"] == ["Delta Ltd"]
    assert og.parse_block(og.md_block(gs))["promoter_pct"] == "51.20%"
    lay = og.layout(data)
    assert lay["height"] > 100 and sum(b["kind"] == "entity" for b in lay["boxes"]) == 4


def _fake_llm(prompt: str) -> str:
    keys = [k for k, _t, u in cam_v2.SECTIONS if u]
    return "\n".join(f"###SECTION:{k}###\nCommentary for {k}. DSCR of 2.18x." for k in keys if f"###SECTION:{k}###" in prompt)


def test_v2_generates_every_section_with_placeholders_and_info_list():
    fin = {"deep": DEEP, "facility": FAC, "company_info": {"name": "Co Ltd"}, "peers": []}
    gs = {"borrower": "Co Ltd", "entities": [{"name": "Beta GmbH", "relation": "subsidiary", "holding_pct": 100}]}
    out = cam_v2.generate(fin, "Co Ltd", "", {}, {}, gs, llm=_fake_llm)
    keys = [k for k, _t, _u in cam_v2.SECTIONS]
    assert all(k in out and out[k]["content"] for k in keys)
    assert all(out[k]["drafted"] for k in keys)
    assert "```organogram" in out["group_organogram"]["content"]
    assert "[RM to provide]" in out["proposed_structure"]["content"]
    assert any("Purpose" in i["item"] for i in out["_info_requests"])
    assert "FY2031E" not in out["financial_analysis"]["content"] and "FY31E" in out["financial_analysis"]["content"]



def test_v2_redrafts_only_the_listed_sections():
    fin = {"deep": DEEP, "facility": FAC, "company_info": {"name": "Co Ltd"}, "peers": []}
    prompts = []
    llm = lambda p: (prompts.append(p), _fake_llm(p))[1]
    out = cam_v2.generate(fin, "Co Ltd", "", {}, {}, {}, llm=llm, only=["industry_analysis", "risk_summary"])
    assert set(out) == {"industry_analysis", "risk_summary"}  # no summary/flags on a partial redraft
    assert all(out[k]["drafted"] for k in out)
    assert not any("###SECTION:financial_analysis###" in p for p in prompts)
    assert cam_v2.generate(fin, "Co Ltd", "", {}, {}, {}, llm=llm, only=["not_a_section"]) == {}

def test_rating_summary_normalises_grades():
    res = {"topics": {"ratings": {"ratings": [
        {"agency": "ICRA", "rating": "[ICRA]AA+ (Stable)/[ICRA]A1+", "outlook": "Stable", "action": "reaffirmed"},
        {"agency": "CARE", "rating": "CARE AA+", "outlook": "Stable"},
        {"agency": "CARE", "rating": "CARE A1+"},
        {"agency": "ICRA", "rating": "[ICRA]AA", "action": "withdrawn"}]}}}
    assert cam_v2.rating_summary(res) == "ICRA: AA+ (Stable) / A1+; CARE: AA+ (Stable) / A1+"


def test_current_ratio_never_reported_as_breach():
    fin = {"deep": DEEP, "facility": FAC}
    ctx = cam_v2.build_ctx(fin, "Co", "", {}, {}, {})
    ctx["ratios"]["current_ratio"] = 1.05
    assert "Not complied" not in [r for r in cam_v2.covenant_test_table(ctx).splitlines() if "Current Ratio" in r][0]


def test_annual_report_millions_become_crore_in_cam_text():
    assert cam_v2.to_crore_text("limits of ₹40,080 million; loan of ₹ 210.66 million") == "limits of ₹4,008 Cr; loan of ₹21.1 Cr"


def test_unsupported_conduct_claims_are_scrubbed():
    t = "reflecting strong ratings and unblemished banking conduct."
    assert "[RM to provide: account conduct]" in cam_v2.scrub_assurances(t, False)
    assert cam_v2.scrub_assurances(t, True) == t


def test_figure_audit_ignores_numbers_of_other_ratios():
    from validators import audit_memo_figures
    r = {"debt_equity": 0.76, "dscr": 2.9}
    assert audit_memo_figures("covenants on TOL/TNW, Debt/Equity, DSCR (2.90x) and ICR", r) == []
    assert audit_memo_figures("Debt/Equity stood at 1.90x", r)  # a real mismatch still flags


def test_negative_working_capital_cycle_is_not_weak_liquidity():
    import copy
    deep = copy.deepcopy(DEEP)
    r = deep["rows"]
    r["cash_conversion_cycle"] = [-60, -62, -70, -72, -89]
    r["st_borrowings"] = [0] * 5
    r["trade_payables"] = [600, 650, 700, 760, 800]    # current ratio < 1
    r["lt_borrowings"] = [20] * 5
    r["borrowings"] = [30] * 5
    c = cma.build(deep, FAC)
    assert c["actuals"][-1]["current_ratio"] < 1
    assert c["assessment"]["liquidity"]["rating"] == "Strong"
    assert "Negative cash-conversion cycle" in c["assessment"]["liquidity"]["basis"]


def test_zero_amount_reads_nil():
    assert cam_v2.fa(0) == "Nil" and cam_v2.fa(0.0) == "Nil" and cam_v2.fa(None) == "—"
