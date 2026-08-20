import cam_sections
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


def test_generate_cam_sections_flags_recommendation_conflict(monkeypatch, tatasteel_financials):
    # Force the individual (non-batch) drafting path so each section is a single
    # _llm() call we can key off of by prompt content.
    monkeypatch.setenv("MEMO_PROVIDER", "ollama")

    def fake_llm(prompt):
        if "**Recommendation**" in prompt:
            return "We recommend approval of the proposed credit facility."
        return "Placeholder analysis text for this section, several sentences long."

    monkeypatch.setattr(cam_sections, "_llm", fake_llm)

    bad_ratios = {
        "dscr": 0.6, "current_ratio": 0.7, "debt_equity": 5.0,
        "interest_coverage": 0.8, "net_margin": -3.0, "roce": -1.0,
    }
    sections = cam_sections.generate_cam_sections(
        tatasteel_financials, bad_ratios, "Test Co", research_brief=""
    )
    assert "Recommendation Consistency Check" in sections["recommendation"]["content"]
