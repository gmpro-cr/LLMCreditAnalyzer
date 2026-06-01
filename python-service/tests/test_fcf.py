from finance_utils import free_cash_flow


def test_fcf_is_ocf_minus_capex():
    assert free_cash_flow(ocf=31961, capex=25663) == 6298


def test_fcf_handles_negative_capex_sign():
    # capex magnitude is what matters, sign-agnostic
    assert free_cash_flow(ocf=31961, capex=-25663) == 6298
