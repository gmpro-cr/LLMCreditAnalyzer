import pytest

from cam_sections import generate_cam_sections
from llm_judge import judge_section

MIN_SCORE = 3


@pytest.mark.llm_judge
@pytest.mark.parametrize("fixture_name", ["healthy_co", "distressed_co"])
def test_recommendation_section_quality(request, fixture_name):
    fixture = request.getfixturevalue(fixture_name)
    sections = generate_cam_sections(
        fixture["financials"], fixture["ratios"], fixture["company_name"],
        research_brief="",
    )
    content = sections["recommendation"]["content"]
    score = judge_section(content)
    assert score["coherence"] >= MIN_SCORE, score
    assert score["actionability"] >= MIN_SCORE, score
