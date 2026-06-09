"""Tests for credit_risk_engine — the deterministic pre-computation core.

The LLM never does arithmetic; every number it sees comes from here.
These tests pin down the helpers, validation gate, metric computation,
and the red-flag / mitigant detectors.
"""
import pytest

from credit_risk_engine import (
    _n,
    _pct,
    _ratio,
    _yoy_pct,
    _cagr,
    validate_inputs,
    extract_yearly_data,
    compute_metrics,
    detect_red_flags,
    detect_mitigants,
    build_context,
)


# ── Helper coercion ────────────────────────────────────────────────────────────

def test_n_handles_numbers_strings_and_garbage():
    assert _n(42) == 42.0
    assert _n("1,234.5") == 1234.5
    assert _n(None) is None
    assert _n("") is None
    assert _n("N/A") is None
    assert _n("not a number") is None


def test_n_unwraps_nested_dicts():
    assert _n({"total": 100}) == 100.0
    assert _n({"current": "2,500"}) == 2500.0
    assert _n({"unrelated": 1}) is None


def test_pct_and_ratio_refuse_division_by_zero():
    assert _pct(50, 0) is None
    assert _pct(50, None) is None
    assert _pct(50, 200) == 25.0
    assert _ratio(100, 0) is None
    assert _ratio(100, 50) == 2.0


def test_yoy_and_cagr():
    assert _yoy_pct(110, 100) == 10.0
    assert _yoy_pct(90, -100) == 190.0  # divides by abs(previous)
    assert _yoy_pct(100, 0) is None
    assert _cagr(100, 121, 2) == 10.0
    assert _cagr(-5, 100, 2) is None  # negative start is meaningless
    assert _cagr(100, 200, 0) is None


# ── Fixtures ───────────────────────────────────────────────────────────────────

def screener_financials(revenue, ebitda, pat, debt, equity, interest, cfo,
                        years=None):
    """Build a minimal Screener-format payload with parallel per-year arrays."""
    n = len(revenue)
    years = years or [f"Mar 20{20 + i}" for i in range(n)]
    return {
        "source": "screener",
        "company_info": {"name": "TestCo", "industry": "Manufacturing",
                         "about": "A test company"},
        "profit_loss": {
            "years": years,
            "revenue": revenue,
            "ebitda": ebitda,
            "pat": pat,
            "interest": interest,
            "opm_pct": [None] * n,
            "depreciation": [None] * n,
        },
        "balance_sheet": {
            "borrowings": debt,
            "total_equity": equity,
            "total_assets": [None] * n,
        },
        "cash_flow": {"operating": cfo, "free_cash_flow": [None] * n},
    }


@pytest.fixture
def healthy_co():
    """3 years of clean growth, low leverage, strong coverage."""
    return screener_financials(
        revenue=[1000, 1150, 1300],
        ebitda=[200, 240, 280],
        pat=[100, 120, 140],
        debt=[200, 190, 180],
        equity=[500, 600, 720],
        interest=[20, 19, 18],
        cfo=[150, 170, 200],
    )


@pytest.fixture
def distressed_co():
    """Falling CFO, thin coverage, heavy leverage, losses."""
    return screener_financials(
        revenue=[1000, 980, 950],
        ebitda=[80, 60, 40],
        pat=[10, 5, -30],
        debt=[800, 950, 1100],
        equity=[400, 390, 350],
        interest=[70, 80, 95],
        cfo=[90, 50, 20],
    )


# ── Section 1: validation gate ────────────────────────────────────────────────

def test_validate_healthy_screener_data(healthy_co):
    v = validate_inputs(healthy_co)
    assert v["sufficient"] is True
    assert v["years_available"] == 3
    assert v["has_qualitative"] is True
    assert v["has_cash_flow"] is True


def test_validate_downgrades_confidence_on_short_history():
    fin = screener_financials(
        revenue=[1000, 1100], ebitda=[200, 220], pat=[100, 110],
        debt=[200, 200], equity=[500, 550], interest=[20, 20],
        cfo=[150, 160],
    )
    v = validate_inputs(fin)
    assert v["confidence_level"] == "LOW"
    assert any("Insufficient financial history" in w for w in v["warnings"])
    # Soft gate: downgraded, not aborted
    assert v["sufficient"] is True


def test_validate_flags_missing_qualitative_data(healthy_co):
    healthy_co["company_info"] = {}
    v = validate_inputs(healthy_co)
    assert v["has_qualitative"] is False
    assert v["confidence_level"] == "LOW"


# ── Section 2 + 3: extraction and metrics ─────────────────────────────────────

def test_extract_yearly_preserves_nulls(healthy_co):
    healthy_co["profit_loss"]["ebitda"][1] = None
    yearly = extract_yearly_data(healthy_co)
    assert len(yearly) == 3
    assert yearly[1]["ebitda"] is None  # null, never coerced to 0
    assert yearly[2]["revenue"] == 1300


def test_compute_metrics_per_year_ratios(healthy_co):
    yearly = extract_yearly_data(healthy_co)
    m = compute_metrics(yearly)
    last = m["per_year"][-1]
    assert last["ebitda_margin"] == pytest.approx(21.54, abs=0.01)
    assert last["debt_equity"] == 0.25
    assert last["interest_coverage"] == pytest.approx(15.56, abs=0.01)
    assert last["cfo_to_pat"] == pytest.approx(1.43, abs=0.01)


def test_compute_metrics_trends(healthy_co):
    yearly = extract_yearly_data(healthy_co)
    trends = compute_metrics(yearly)["trends"]
    assert trends["revenue_yoy"] == pytest.approx(13.0, abs=0.1)
    assert trends["revenue_cagr"] == pytest.approx(14.0, abs=0.1)


def test_metrics_are_null_when_inputs_missing():
    fin = screener_financials(
        revenue=[1000, 1100], ebitda=[None, None], pat=[100, 110],
        debt=[200, 200], equity=[500, 550], interest=[None, None],
        cfo=[None, None],
    )
    m = compute_metrics(extract_yearly_data(fin))
    last = m["per_year"][-1]
    assert last["ebitda_margin"] is None
    assert last["interest_coverage"] is None
    assert last["dscr"] is None


# ── Red flags ─────────────────────────────────────────────────────────────────

def test_healthy_company_has_no_red_flags(healthy_co):
    yearly = extract_yearly_data(healthy_co)
    flags = detect_red_flags(yearly, compute_metrics(yearly))
    assert flags == []


def test_distressed_company_triggers_expected_flags(distressed_co):
    yearly = extract_yearly_data(distressed_co)
    flags = detect_red_flags(yearly, compute_metrics(yearly))
    names = [f["flag"] for f in flags]
    assert any("interest coverage" in n for n in names)
    assert any("Net losses" in n for n in names)
    assert any("leverage" in n.lower() for n in names)
    # Every flag must carry evidence and severity
    for f in flags:
        assert f["evidence"]
        assert f["severity"] in ("HIGH", "MEDIUM")


def test_red_flags_need_two_years_of_data():
    fin = screener_financials(
        revenue=[1000], ebitda=[50], pat=[-20], debt=[900], equity=[300],
        interest=[80], cfo=[10],
    )
    yearly = extract_yearly_data(fin)
    assert detect_red_flags(yearly, compute_metrics(yearly)) == []


def test_cfo_pat_disconnect_flagged():
    fin = screener_financials(
        revenue=[1000, 1100], ebitda=[200, 220], pat=[100, 110],
        debt=[100, 100], equity=[500, 550], interest=[10, 10],
        cfo=[120, 30],  # profits no longer backed by cash
    )
    yearly = extract_yearly_data(fin)
    flags = detect_red_flags(yearly, compute_metrics(yearly))
    assert any("not adequately backed" in f["flag"] for f in flags)


# ── Mitigants ─────────────────────────────────────────────────────────────────

def test_mitigants_for_healthy_company(healthy_co):
    yearly = extract_yearly_data(healthy_co)
    mit = detect_mitigants(yearly, compute_metrics(yearly), healthy_co)
    joined = " ".join(mit)
    assert "EBITDA margin" in joined
    assert "Debt/Equity" in joined
    assert "interest coverage" in joined


def test_promoter_holding_mitigant(healthy_co):
    healthy_co["shareholding"] = {"promoter_holding_pct": 65.2}
    yearly = extract_yearly_data(healthy_co)
    mit = detect_mitigants(yearly, compute_metrics(yearly), healthy_co)
    assert any("promoter holding" in m.lower() for m in mit)


def test_distressed_company_gets_no_false_mitigants(distressed_co):
    yearly = extract_yearly_data(distressed_co)
    mit = detect_mitigants(yearly, compute_metrics(yearly), distressed_co)
    assert mit == []


# ── build_context end-to-end ──────────────────────────────────────────────────

def test_build_context_healthy_path(healthy_co):
    ctx = build_context(healthy_co, ratios={}, company_name="TestCo")
    assert ctx["abort"] is False
    assert ctx["red_flags"] == []
    assert len(ctx["mitigants"]) >= 2
    text = ctx["context_text"]
    assert "TestCo" in text
    assert "PRE-COMPUTED CREDIT RISK DATA" in text
    assert "AUTO-DETECTED RED FLAGS (0 found)" in text


def test_build_context_reports_nulls_honestly():
    fin = screener_financials(
        revenue=[1000, 1100, 1200], ebitda=[None, None, None],
        pat=[100, 110, 120], debt=[200, 200, 200],
        equity=[500, 550, 600], interest=[None, None, None],
        cfo=[None, None, None],
    )
    ctx = build_context(fin, ratios={})
    assert "null — cannot be computed" in ctx["context_text"]
