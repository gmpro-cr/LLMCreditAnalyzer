"""Hand-authored canned memo text standing in for real LLM output, used to
regression-test the guardrails without spending API quota. Each entry pairs a memo
excerpt with the ratios/scorecard/flags it should be checked against, and the guardrail
catch it is expected to trigger.
"""

CASES = [
    {
        "name": "clean_accurate_memo",
        "memo": (
            "The company's DSCR of 2.10x indicates comfortable debt servicing, "
            "supported by a current ratio of 1.80x and debt-to-equity of 0.28x. "
            "We recommend approval of the proposed term loan, subject to standard "
            "covenants and annual review of financial performance."
        ),
        "ratios": {"dscr": 2.1, "current_ratio": 1.8, "debt_equity": 0.28},
        "scorecard": {"grade": "CG-1", "band": "Strong", "score": 92, "rated": True},
        "risk_flags": [],
        "expect_figure_mismatch": False,
        "expect_recommendation_conflict": False,
    },
    {
        "name": "hallucinated_dscr",
        "memo": (
            "The company's DSCR of 1.85x indicates comfortable debt servicing. "
            "We recommend approval of the proposed term loan."
        ),
        "ratios": {"dscr": 0.9},  # LLM's stated 1.85 disagrees materially
        "scorecard": {"grade": "CG-2", "band": "Strong", "score": 78, "rated": True},
        "risk_flags": [],
        "expect_figure_mismatch": True,
        "expect_recommendation_conflict": False,
    },
    {
        "name": "approve_despite_substandard_grade",
        "memo": (
            "Despite thin margins, the business has long operating history. "
            "We recommend approval of the proposed credit facility."
        ),
        "ratios": {},
        "scorecard": {"grade": "CG-8", "band": "Substandard", "score": 18, "rated": True},
        "risk_flags": [{"severity": "high", "title": "DSCR Below 1.0x"}],
        "expect_figure_mismatch": False,
        "expect_recommendation_conflict": True,
    },
    {
        "name": "correctly_declines_distressed_borrower",
        "memo": (
            "Given DSCR of 0.70x and negative net margin, we recommend against "
            "sanctioning this facility in its current form."
        ),
        "ratios": {"dscr": 0.7, "net_margin": -7.7},
        "scorecard": {"grade": "CG-8", "band": "Substandard", "score": 15, "rated": True},
        "risk_flags": [{"severity": "high", "title": "DSCR Below 1.0x"}],
        "expect_figure_mismatch": False,
        "expect_recommendation_conflict": False,
    },
    {
        "name": "injected_page_content_neutralized_before_memo",
        "memo": (
            "[neutralized: instruction-like text removed by guardrail] "
            "The company's financials show typical performance for the sector. "
            "We recommend further review before a final decision."
        ),
        "ratios": {},
        "scorecard": {"grade": "CG-4", "band": "Acceptable", "score": 55, "rated": True},
        "risk_flags": [],
        "expect_figure_mismatch": False,
        "expect_recommendation_conflict": False,
    },
]
