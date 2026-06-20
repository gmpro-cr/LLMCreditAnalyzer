"""Deterministic internal credit-rating scorecard. No LLM, no I/O.

Produces a transparent, rule-based grade (CG-1 best … CG-8 worst) from the
computed ratios, so the rating doesn't depend on LLM prose. Factors with no
data are excluded and the remaining weights are renormalised.
"""
from typing import Dict, Any, List, Optional

from finance_utils import as_number


def _num(v) -> Optional[float]:
    if isinstance(v, list) and v:
        return as_number(v[-1])
    return as_number(v)


# Each factor: weight + ordered (threshold, points) bands.
# higher_better=True → value >= threshold earns those points (first match wins,
# bands listed high→low). higher_better=False → value <= threshold earns points.
_FACTORS = [
    {"key": "dscr", "label": "DSCR", "weight": 0.25, "higher_better": True,
     "bands": [(2.0, 100), (1.5, 80), (1.25, 60), (1.0, 35), (-1e9, 10)]},
    {"key": "debt_equity", "label": "Debt / Equity", "weight": 0.20, "higher_better": False,
     "bands": [(0.5, 100), (1.0, 85), (2.0, 65), (3.0, 40), (1e9, 15)]},
    {"key": "interest_coverage", "label": "Interest Coverage", "weight": 0.15, "higher_better": True,
     "bands": [(4.0, 100), (2.5, 80), (1.5, 55), (1.0, 30), (-1e9, 10)]},
    {"key": "current_ratio", "label": "Current Ratio", "weight": 0.15, "higher_better": True,
     "bands": [(2.0, 100), (1.33, 80), (1.0, 55), (0.8, 30), (-1e9, 10)]},
    {"key": "net_margin", "label": "Net Margin %", "weight": 0.15, "higher_better": True,
     "bands": [(15.0, 100), (8.0, 80), (3.0, 55), (0.0, 30), (-1e9, 10)]},
    {"key": "roce", "label": "ROCE %", "weight": 0.10, "higher_better": True,
     "bands": [(20.0, 100), (12.0, 80), (6.0, 55), (0.0, 30), (-1e9, 10)]},
]

# weighted-score → (grade, band)
_GRADE_BANDS = [
    (85, "CG-1", "Strong"),
    (75, "CG-2", "Strong"),
    (65, "CG-3", "Acceptable"),
    (55, "CG-4", "Acceptable"),
    (45, "CG-5", "Watch"),
    (35, "CG-6", "Watch"),
    (25, "CG-7", "Substandard"),
    (0,  "CG-8", "Substandard"),
]


def _band_points(value: float, bands: List, higher_better: bool) -> int:
    if higher_better:
        for threshold, points in bands:
            if value >= threshold:
                return points
    else:
        for threshold, points in bands:
            if value <= threshold:
                return points
    return bands[-1][1]


def compute_scorecard(financials: Dict, ratios: Dict) -> Dict[str, Any]:
    """Return {grade, band, score, rated, factors:[...], note}. Deterministic."""
    ratios = ratios or {}
    factors: List[Dict[str, Any]] = []
    weighted_sum = 0.0
    weight_total = 0.0

    for f in _FACTORS:
        value = as_number(ratios.get(f["key"]))
        if value is None:
            factors.append({"label": f["label"], "value": None, "points": None,
                            "weight_pct": round(f["weight"] * 100), "available": False})
            continue
        points = _band_points(value, f["bands"], f["higher_better"])
        factors.append({"label": f["label"], "value": round(value, 2), "points": points,
                        "weight_pct": round(f["weight"] * 100), "available": True})
        weighted_sum += points * f["weight"]
        weight_total += f["weight"]

    available = [f for f in factors if f["available"]]
    if len(available) < 2 or weight_total <= 0:
        return {
            "grade": "Unrated", "band": "Unrated", "score": None, "rated": False,
            "factors": factors,
            "note": "Insufficient ratio data to compute an internal rating (need at least 2 core ratios).",
        }

    score = round(weighted_sum / weight_total, 1)  # renormalise over available weights
    grade, band = next((g, b) for cut, g, b in _GRADE_BANDS if score >= cut)
    return {
        "grade": grade, "band": band, "score": score, "rated": True,
        "factors": factors,
        "note": "Rule-based internal rating computed from the financial spread. Indicative — subject to RM/credit-officer override.",
    }


def format_scorecard_md(sc: Dict[str, Any]) -> str:
    """Render the scorecard as a markdown block for the CAM."""
    if not sc:
        return ""
    lines = ["## Internal Credit Rating (Model)", ""]
    if not sc.get("rated"):
        lines += [f"_{sc.get('note', 'Unrated.')}_", ""]
        return "\n".join(lines)
    lines += [
        f"**Grade: {sc['grade']} — {sc['band']}**  |  Model score: {sc['score']}/100",
        "",
        "| Factor | Value | Weight | Score |",
        "|---|---|---|---|",
    ]
    for f in sc["factors"]:
        val = "N/A" if f["value"] is None else f["value"]
        pts = "—" if f["points"] is None else f["points"]
        lines.append(f"| {f['label']} | {val} | {f['weight_pct']}% | {pts} |")
    lines += ["", f"_{sc['note']}_", ""]
    return "\n".join(lines)
