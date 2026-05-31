from ratios import calculate_ratios


def test_tol_tnw_excludes_networth(tatasteel_financials):
    """TOL = Total Assets - Net Worth (must exclude equity from the numerator).

    TA=272747, NW=135534 -> TOL=137213 -> TOL/TNW = 1.01 (was wrongly 2.01).
    """
    r = calculate_ratios(tatasteel_financials)
    assert r["tol_tnw"] == 1.01
