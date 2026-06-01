from cam_sections import _with_tables


def test_with_tables_appends_spread_and_ratios(tatasteel_financials):
    out = _with_tables("Narrative prose.", tatasteel_financials,
                       {"tol_tnw": 1.01, "debt_equity": 0.51})
    assert out.startswith("Narrative prose.")
    assert "Financial Spread (₹ Cr)" in out
    assert "Particulars (₹ Cr)" in out
    assert "Key Ratios vs Covenants" in out
    assert "verify against audited" in out


def test_with_tables_noop_when_empty():
    assert _with_tables("x", {}, {}) == "x"
