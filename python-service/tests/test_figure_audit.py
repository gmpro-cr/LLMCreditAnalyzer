from validators import audit_memo_figures, apply_figure_audit


def test_mismatch_is_flagged():
    memo = "The company's DSCR of 1.85 indicates comfortable debt servicing."
    issues = audit_memo_figures(memo, {"dscr": 1.42})
    assert len(issues) == 1
    assert issues[0]["ratio"] == "dscr"
    assert issues[0]["stated"] == 1.85
    assert issues[0]["computed"] == 1.42


def test_matching_figure_passes():
    memo = "The current ratio of 1.50 is adequate."
    issues = audit_memo_figures(memo, {"current_ratio": 1.5})
    assert issues == []


def test_within_tolerance_passes():
    memo = "Net profit margin of 8.0% is healthy."
    issues = audit_memo_figures(memo, {"net_margin": 8.4})  # within 10%
    assert issues == []


def test_apply_appends_section_only_on_mismatch():
    memo = "Interest coverage of 5.0x is strong."
    out = apply_figure_audit(memo, {"interest_coverage": 2.0})
    assert "Figure Verification" in out
    clean = apply_figure_audit("Interest coverage of 2.0x.", {"interest_coverage": 2.0})
    assert "Figure Verification" not in clean


def test_missing_computed_ratio_is_skipped():
    memo = "ROCE of 19% looks good."
    assert audit_memo_figures(memo, {}) == []
