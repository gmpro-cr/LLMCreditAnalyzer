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
