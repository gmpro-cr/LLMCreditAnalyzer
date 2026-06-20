from credit_score import compute_scorecard, format_scorecard_md


def test_strong_borrower_gets_high_grade():
    ratios = {"dscr": 2.5, "debt_equity": 0.4, "interest_coverage": 6.0,
              "current_ratio": 2.1, "net_margin": 18.0, "roce": 22.0}
    sc = compute_scorecard({}, ratios)
    assert sc["rated"] is True
    assert sc["score"] >= 85
    assert sc["grade"] == "CG-1"
    assert sc["band"] == "Strong"


def test_weak_borrower_gets_low_grade():
    ratios = {"dscr": 0.8, "debt_equity": 4.5, "interest_coverage": 0.9,
              "current_ratio": 0.7, "net_margin": -5.0, "roce": -2.0}
    sc = compute_scorecard({}, ratios)
    assert sc["rated"] is True
    assert sc["score"] < 25
    assert sc["grade"] == "CG-8"
    assert sc["band"] == "Substandard"


def test_insufficient_data_is_unrated():
    sc = compute_scorecard({}, {"dscr": 1.5})  # only one factor
    assert sc["rated"] is False
    assert sc["grade"] == "Unrated"


def test_weights_renormalise_over_available_factors():
    # Two strong factors present, rest missing → should still rate (and high).
    sc = compute_scorecard({}, {"dscr": 2.5, "current_ratio": 2.1})
    assert sc["rated"] is True
    assert sc["score"] == 100.0


def test_format_scorecard_md_contains_grade_and_table():
    sc = compute_scorecard({}, {"dscr": 1.6, "debt_equity": 1.2,
                                "current_ratio": 1.4, "net_margin": 9.0})
    md = format_scorecard_md(sc)
    assert "Internal Credit Rating" in md
    assert sc["grade"] in md
    assert "| Factor |" in md
