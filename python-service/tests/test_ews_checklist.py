from ews_checklist import STANDARD_EWS_PARAMETERS, format_ews_checklist_md


def test_has_a_reasonable_number_of_standard_parameters():
    assert len(STANDARD_EWS_PARAMETERS) >= 8


def test_each_parameter_has_a_label_and_description():
    for p in STANDARD_EWS_PARAMETERS:
        assert p.get("label")
        assert p.get("description")


def test_markdown_table_has_expected_header_and_columns():
    md = format_ews_checklist_md()
    assert "| Parameter | Description | Trigger Status | Action Point |" in md
    assert "Early Warning Signal" in md


def test_markdown_table_lists_every_standard_parameter():
    md = format_ews_checklist_md()
    for p in STANDARD_EWS_PARAMETERS:
        assert p["label"] in md


def test_markdown_table_leaves_trigger_and_action_columns_for_rm_to_fill():
    md = format_ews_checklist_md()
    # At least one row should have the placeholder rather than a hallucinated status
    assert "To be monitored" in md
