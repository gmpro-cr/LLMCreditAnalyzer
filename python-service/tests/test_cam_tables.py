from cam_tables import financial_spread, ratio_covenant_table


def test_spread_has_years_as_columns(tatasteel_financials):
    md = financial_spread(tatasteel_financials)
    for yr in ("Mar 2024", "Mar 2025", "Mar 2026"):
        assert yr in md
    assert "Revenue from Operations" in md
    assert "PAT" in md
    assert "Net Worth" in md
    assert md.count("|") > 6   # is an actual markdown table


def test_spread_formats_crores_without_paise(tatasteel_financials):
    md = financial_spread(tatasteel_financials)
    assert ".00" not in md           # no two-decimal crore figures
    assert "1,40,933" in md or "140,933" in md


def test_ratio_table_marks_within_and_breach():
    md = ratio_covenant_table({"tol_tnw": 4.0, "debt_equity": 0.5})
    assert "Breach" in md            # 4.0 > 3.00 covenant
    assert "Within" in md            # 0.5 <= 2.00 covenant


def test_ratio_table_flags_estimated_dscr():
    md = ratio_covenant_table({"dscr": 1.12, "dscr_estimated": True})
    assert "est." in md


def test_ratio_table_empty_without_ratios():
    assert ratio_covenant_table({}) == ""
