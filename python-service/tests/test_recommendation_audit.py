from validators import (
    classify_recommendation,
    audit_recommendation_consistency,
    apply_recommendation_audit,
)


def test_classify_approve():
    assert classify_recommendation("We recommend approval of the credit facility.") == "approve"


def test_classify_decline():
    assert classify_recommendation("We recommend against sanctioning this facility.") == "decline"


def test_classify_conditional():
    assert classify_recommendation("Recommended subject to additional collateral cover.") == "conditional"


def test_classify_unclear_on_empty():
    assert classify_recommendation("") == "unclear"


def test_flags_approve_against_substandard_grade():
    memo = "We recommend approval of the proposed term loan."
    scorecard = {"grade": "CG-8", "band": "Substandard", "score": 20, "rated": True}
    issues = audit_recommendation_consistency(memo, scorecard, [])
    assert len(issues) == 1
    assert issues[0]["type"] == "grade_conflict"


def test_flags_approve_against_high_risk_flags():
    memo = "We recommend approval of the proposed term loan."
    high_flags = [{"severity": "high", "title": "Low Liquidity"}]
    issues = audit_recommendation_consistency(memo, {}, high_flags)
    assert len(issues) == 1
    assert issues[0]["type"] == "risk_flag_conflict"


def test_no_flag_when_decline_matches_substandard_grade():
    memo = "We recommend against approving this facility given weak fundamentals."
    scorecard = {"grade": "CG-8", "band": "Substandard", "score": 20, "rated": True}
    assert audit_recommendation_consistency(memo, scorecard, []) == []


def test_no_flag_when_grade_is_strong():
    memo = "We recommend approval of the proposed term loan."
    scorecard = {"grade": "CG-1", "band": "Strong", "score": 90, "rated": True}
    assert audit_recommendation_consistency(memo, scorecard, []) == []


def test_apply_appends_section_only_on_conflict():
    memo = "We recommend approval."
    scorecard = {"grade": "CG-8", "band": "Substandard", "score": 20, "rated": True}
    out = apply_recommendation_audit(memo, scorecard, [])
    assert "Recommendation Consistency Check" in out
    clean = apply_recommendation_audit(memo, {"grade": "CG-1", "band": "Strong"}, [])
    assert "Recommendation Consistency Check" not in clean
