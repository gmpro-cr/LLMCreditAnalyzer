from memo import _clean_money, _build_credit_risk_prompt


def test_clean_money_strips_paise_on_crores():
    s = "Revenue of ₹139,720.00 Cr up from ₹132,517.00 Cr and ₹6,298.0 Cr FCF"
    out = _clean_money(s)
    assert out == "Revenue of ₹139,720 Cr up from ₹132,517 Cr and ₹6,298 Cr FCF"


def test_clean_money_leaves_ratios_untouched():
    # x.00 not followed by 'Cr' (e.g. a ratio) must be left alone
    assert _clean_money("DSCR of 1.25 and margin 23.24%") == "DSCR of 1.25 and margin 23.24%"


def test_prompt_includes_confidence_cap_when_provided():
    p = _build_credit_risk_prompt("CTX", "Acme Ltd", max_confidence="MEDIUM")
    assert "MEDIUM" in p
    assert "cap" in p.lower() or "must not exceed" in p.lower()
