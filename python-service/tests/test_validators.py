from validators import data_quality_report, apply_data_quality


def test_missing_pat_caps_confidence_to_low():
    fin = {"profit_loss": {"pat": "Dividend Yield"}, "balance_sheet": {}}
    rep = data_quality_report(fin, ratios={})
    assert rep["max_confidence"] == "LOW"
    assert any(i["field"] == "pat" for i in rep["issues"])


def test_balance_sheet_imbalance_flagged():
    fin = {"profit_loss": {"pat": [100, 110, 120]},
           "balance_sheet": {"total_assets": [100], "total_equity": [40],
                             "borrowings": [30], "other_liabilities": [10]}}  # 80 != 100
    rep = data_quality_report(fin, ratios={"current_ratio": 1.5})
    assert any("balance" in i["message"].lower() for i in rep["issues"])
    assert rep["max_confidence"] == "MEDIUM"


def test_clean_data_allows_high():
    fin = {"profit_loss": {"pat": [100, 110, 120]},
           "balance_sheet": {"total_assets": [100], "total_equity": [40],
                             "borrowings": [50], "other_liabilities": [10]}}  # 100 == 100
    rep = data_quality_report(fin, ratios={"current_ratio": 1.5})
    assert rep["passed"] is True
    assert rep["max_confidence"] == "HIGH"


def test_apply_caps_confidence_and_appends_limitations():
    memo = "## 7. Overall Risk Assessment\n**LOW RISK**\n\n## 8. Confidence Level\n**HIGH**\n"
    rep = {"max_confidence": "MEDIUM",
           "issues": [{"field": "pat", "severity": "critical", "message": "PAT missing"}]}
    out = apply_data_quality(memo, rep)
    assert "**HIGH**" not in out          # confidence capped
    assert "**MEDIUM**" in out
    assert "**LOW RISK**" in out          # risk rating untouched
    assert "Data Quality & Limitations" in out
    assert "PAT missing" in out
