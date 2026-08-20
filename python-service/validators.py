"""Deterministic data-quality gate for credit memos. No LLM, no I/O.

Two responsibilities:
  1. data_quality_report() — inspect the spread and flag integrity issues, and
     compute the maximum confidence the data can support.
  2. apply_data_quality() — clamp the confidence stated in a generated memo and
     append a "Data Quality & Limitations" section.
"""
import re
from typing import Optional

from finance_utils import as_number

_CONF_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


def _last(x) -> Optional[float]:
    if isinstance(x, list) and x:
        return as_number(x[-1])
    return as_number(x)


def data_quality_report(financials: dict, ratios: dict) -> dict:
    issues = []
    pl = financials.get("profit_loss", {}) or {}
    bs = financials.get("balance_sheet", {}) or {}
    ratios = ratios or {}

    # 1) PAT present & numeric (critical — profitability/ROE depend on it)
    pat = pl.get("pat")
    pat_ok = isinstance(pat, list) and pat and as_number(pat[-1]) is not None
    if not pat_ok:
        issues.append({"field": "pat", "severity": "critical",
                       "message": "PAT (Net Profit) is missing or non-numeric — "
                                  "profitability, ROE and net-margin are unreliable."})

    # 2) Balance-sheet identity A = L + E (5% tolerance)
    ta = _last(bs.get("total_assets"))
    eq = _last(bs.get("total_equity"))
    debt = _last(bs.get("borrowings"))
    oth = _last(bs.get("other_liabilities"))
    if ta and eq is not None:
        rhs = (eq or 0) + (debt or 0) + (oth or 0)
        if rhs and abs(rhs - ta) / ta > 0.05:
            issues.append({"field": "balance_sheet", "severity": "high",
                           "message": f"Balance sheet does not balance: "
                                      f"Assets={ta:,.0f} vs Liabilities+Equity={rhs:,.0f}."})

    # 3) Liquidity ratios computable (current ratio needs current assets/liabilities)
    if "current_ratio" not in ratios:
        issues.append({"field": "current_ratio", "severity": "high",
                       "message": "Current/quick ratio not computable — current assets or "
                                  "liabilities missing from the spread."})

    severities = {i["severity"] for i in issues}
    if "critical" in severities:
        max_conf = "LOW"
    elif "high" in severities:
        max_conf = "MEDIUM"
    else:
        max_conf = "HIGH"

    return {"passed": not issues, "issues": issues, "max_confidence": max_conf}


def apply_data_quality(memo: str, report: dict) -> str:
    """Clamp the memo's stated confidence to report['max_confidence'] and append limitations."""
    max_conf = report.get("max_confidence", "HIGH")
    cap = _CONF_RANK.get(max_conf, 2)

    def _over(stated):
        return _CONF_RANK.get(stated.upper(), 2) > cap

    # Standalone bold confidence words (e.g. **HIGH**); never "**LOW RISK**".
    memo = re.sub(r"\*\*(HIGH|MEDIUM|LOW)\*\*",
                  lambda m: f"**{max_conf}**" if _over(m.group(1)) else m.group(0),
                  memo, flags=re.IGNORECASE)
    # Plaintext header form, e.g. "Confidence: HIGH".
    memo = re.sub(r"(Confidence:\s*)(HIGH|MEDIUM|LOW)",
                  lambda m: m.group(1) + max_conf if _over(m.group(2)) else m.group(0),
                  memo, flags=re.IGNORECASE)

    issues = report.get("issues", [])
    if issues:
        lines = ["", "", "## Data Quality & Limitations", ""]
        for i in issues:
            lines.append(f"- **{i['severity'].upper()}** — {i['message']}")
        lines += ["", f"_Maximum supportable confidence given the above: **{max_conf}**. "
                      f"All figures must be verified against audited financial statements._"]
        memo += "\n".join(lines)
    return memo


# ── Number grounding: cross-check figures cited in the memo vs computed ───────
# Heuristic guard against hallucinated/altered ratios: find a ratio's label in
# the prose, read the number stated right after it, and compare to the value
# Python computed. Advisory only (flags for reconciliation), never blocking.

_RATIO_LABELS = {
    "dscr":              ["debt service coverage", "debt-service coverage", "dscr"],
    "current_ratio":     ["current ratio"],
    "debt_equity":       ["debt-to-equity", "debt to equity", "debt-equity", "debt/equity", "gearing ratio"],
    "interest_coverage": ["interest coverage", "interest cover"],
    "net_margin":        ["net profit margin", "net margin"],
    "ebitda_margin":     ["ebitda margin"],
    "roce":              ["return on capital employed", "roce"],
    "roe":               ["return on equity"],
}


def audit_memo_figures(memo_text: str, ratios: dict) -> list:
    """Return [{ratio,label,stated,computed}] where a memo-stated ratio differs
    materially from the computed value."""
    import re
    issues = []
    ratios = ratios or {}
    low = (memo_text or "").lower()
    for key, labels in _RATIO_LABELS.items():
        computed = as_number(ratios.get(key))
        if computed is None:
            continue
        for label in labels:
            idx = low.find(label)
            if idx == -1:
                continue
            window = low[idx + len(label): idx + len(label) + 28]
            m = re.search(r"[-+]?\d+(?:\.\d+)?", window)
            if not m:
                continue
            stated = float(m.group())
            tol = max(abs(computed) * 0.10, 0.15)  # 10% or 0.15 absolute
            if abs(stated - computed) > tol:
                issues.append({"ratio": key, "label": label,
                               "stated": stated, "computed": round(computed, 2)})
            break  # only the first label variant per ratio
    return issues


def apply_figure_audit(memo: str, ratios: dict) -> str:
    """Append a Figure Verification section if any cited ratio mismatches."""
    issues = audit_memo_figures(memo, ratios)
    if not issues:
        return memo
    lines = ["", "", "## Figure Verification", "",
             "_Automated cross-check of ratios cited in this memo against the values "
             "computed from the financial spread. Reconcile before reliance._", ""]
    for i in issues:
        lines.append(f"- **{i['label'].upper()}** — memo states {i['stated']}, "
                     f"computed {i['computed']}. Please reconcile.")
    return memo + "\n".join(lines)


# ── Recommendation consistency: narrative vs deterministic grade/flags ────────
# Heuristic guard: if the memo's recommendation section reads as "approve" while
# the deterministic scorecard grade is Substandard or high-severity risk flags are
# present, flag it for reconciliation. Advisory only, never blocking — this mirrors
# the existing "recommendation MUST be authored by RM" scaffold-only disclaimer.

_APPROVE_PATTERNS = [
    r"recommend(?:ed)?\s+(?:for\s+)?approval",
    r"recommend(?:ed)?\s+(?:to\s+)?sanction",
    r"suitable\s+for\s+approval",
    r"approve\s+the\s+(?:proposed\s+)?(?:credit\s+)?facilit\w*",
]
_DECLINE_PATTERNS = [
    r"recommend(?:ed)?\s+against",
    r"recommend(?:ed)?\s+(?:to\s+)?(?:decline|reject)",
    r"not\s+recommend(?:ed)?\s+for\s+approval",
    r"do\s+not\s+recommend",
]
_CONDITIONAL_PATTERNS = [
    r"recommend(?:ed)?.{0,20}\bsubject\s+to\b",
    r"conditional\s+approval",
    r"further\s+review",
    r"recommend(?:ed)?.{0,20}\bwith\s+conditions?\b",
]


def classify_recommendation(memo_text: str) -> str:
    """Return 'approve' | 'decline' | 'conditional' | 'unclear' from a memo's stated
    sentiment. Decline/conditional checked first since 'recommend against approval'
    would otherwise also match an approve pattern."""
    low = (memo_text or "").lower()
    if any(re.search(p, low) for p in _DECLINE_PATTERNS):
        return "decline"
    if any(re.search(p, low) for p in _CONDITIONAL_PATTERNS):
        return "conditional"
    if any(re.search(p, low) for p in _APPROVE_PATTERNS):
        return "approve"
    return "unclear"


def audit_recommendation_consistency(memo_text: str, scorecard: dict, risk_flags: list) -> list:
    """Flag when the memo leans 'approve' while the deterministic grade/risk flags
    say otherwise. Advisory only."""
    if classify_recommendation(memo_text) != "approve":
        return []

    issues = []
    scorecard = scorecard or {}
    if scorecard.get("band") == "Substandard":
        issues.append({
            "type": "grade_conflict",
            "message": f"Memo leans toward approval but the internal model grade is "
                       f"{scorecard.get('grade', 'Unrated')} ({scorecard['band']}).",
        })

    high_flags = [f for f in (risk_flags or []) if f.get("severity") == "high"]
    if high_flags:
        titles = ", ".join(f.get("title", "risk") for f in high_flags[:3])
        issues.append({
            "type": "risk_flag_conflict",
            "message": f"Memo leans toward approval but {len(high_flags)} high-severity "
                       f"risk flag(s) are present: {titles}.",
        })
    return issues


def apply_recommendation_audit(memo: str, scorecard: dict, risk_flags: list) -> str:
    """Append a Recommendation Consistency Check section if the narrative conflicts
    with the deterministic grade/flags."""
    issues = audit_recommendation_consistency(memo, scorecard, risk_flags)
    if not issues:
        return memo
    lines = ["", "", "## Recommendation Consistency Check", "",
             "_Automated cross-check between the narrative recommendation and the "
             "deterministic model grade / risk flags. Reconcile before reliance._", ""]
    for i in issues:
        lines.append(f"- {i['message']}")
    return memo + "\n".join(lines)
