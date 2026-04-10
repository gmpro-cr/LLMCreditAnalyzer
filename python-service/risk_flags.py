"""
Risk Flag Engine — automatically identifies credit risk signals from financial ratios.
Returns a list of risk flags with severity (high/medium/low) and evidence.
"""
from typing import Dict, List, Any


RATIO_RISK_RULES = [
    # (ratio_key, operator, threshold, severity, title, description_template)
    ("current_ratio",       "lt", 1.0,  "high",   "Low Liquidity",
     "Current ratio of {val:.2f}x is below 1.0x, indicating insufficient current assets to cover short-term liabilities."),
    ("current_ratio",       "lt", 1.33, "medium", "Tight Liquidity",
     "Current ratio of {val:.2f}x is below the standard banking threshold of 1.33x."),
    ("debt_equity",         "gt", 3.0,  "high",   "High Leverage",
     "Debt/Equity ratio of {val:.2f}x is significantly elevated, indicating over-reliance on debt financing."),
    ("debt_equity",         "gt", 2.0,  "medium", "Elevated Leverage",
     "Debt/Equity ratio of {val:.2f}x is above the comfortable 2.0x threshold."),
    ("tol_tnw",             "gt", 4.0,  "high",   "High TOL/TNW",
     "TOL/TNW of {val:.2f}x is elevated, suggesting high total outside liabilities relative to net worth."),
    ("interest_coverage",   "lt", 1.5,  "high",   "Weak Interest Coverage",
     "Interest coverage of {val:.2f}x is critically low — EBIT barely covers interest obligations."),
    ("interest_coverage",   "lt", 2.5,  "medium", "Thin Interest Coverage",
     "Interest coverage of {val:.2f}x is below the comfortable 2.5x benchmark."),
    ("dscr",                "lt", 1.0,  "high",   "DSCR Below 1.0x",
     "DSCR of {val:.2f}x is below 1.0x — the borrower cannot service debt from operating cash flows."),
    ("dscr",                "lt", 1.25, "medium", "Tight DSCR",
     "DSCR of {val:.2f}x is below the standard 1.25x benchmark, leaving limited debt-service headroom."),
    ("ebitda_margin",       "lt", 5.0,  "high",   "Very Low EBITDA Margin",
     "EBITDA margin of {val:.1f}% is critically low, limiting debt-servicing capacity."),
    ("ebitda_margin",       "lt", 10.0, "medium", "Low EBITDA Margin",
     "EBITDA margin of {val:.1f}% is below 10%, typical for stressed sectors."),
    ("net_margin",          "lt", 0.0,  "high",   "Net Loss",
     "The company is reporting a net loss (net margin {val:.1f}%), indicating fundamental profitability concerns."),
    ("debtor_days",         "gt", 120,  "high",   "High Debtor Days",
     "Debtor collection period of {val:.0f} days is very high, indicating receivables stress or liberal credit terms."),
    ("debtor_days",         "gt", 90,   "medium", "Elevated Debtor Days",
     "Debtor days of {val:.0f} days is above 90, warranting review of receivables quality."),
    ("inventory_days",      "gt", 180,  "high",   "High Inventory Days",
     "Inventory holding of {val:.0f} days is very high — risk of obsolescence or demand slowdown."),
    ("inventory_days",      "gt", 90,   "medium", "Elevated Inventory Days",
     "Inventory days of {val:.0f} days is above the sector comfort threshold."),
    ("operating_cycle",     "gt", 180,  "medium", "Long Operating Cycle",
     "Operating cycle of {val:.0f} days is extended, increasing working capital funding requirement."),
]


def _check(val: float, operator: str, threshold: float) -> bool:
    if operator == "lt":  return val < threshold
    if operator == "gt":  return val > threshold
    if operator == "lte": return val <= threshold
    if operator == "gte": return val >= threshold
    return False


def generate_risk_flags(ratios: Dict[str, float], financials: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Analyse financial ratios and return a list of risk flags.
    Each flag: {severity, title, description, ratio_key, value}
    """
    flags: List[Dict[str, Any]] = []
    seen_titles: set = set()

    for (ratio_key, operator, threshold, severity, title, desc_template) in RATIO_RISK_RULES:
        val = ratios.get(ratio_key)
        if val is None:
            continue
        if _check(val, operator, threshold):
            if title in seen_titles:
                continue
            seen_titles.add(title)
            flags.append({
                "severity":    severity,
                "title":       title,
                "description": desc_template.format(val=val),
                "ratio_key":   ratio_key,
                "value":       round(val, 3),
            })

    # Check YoY revenue decline (multi-year data)
    pl = financials.get("profit_loss", {})
    revenue = pl.get("revenue", [])
    if isinstance(revenue, list) and len(revenue) >= 2:
        latest = revenue[-1]
        prev   = revenue[-2]
        if prev and prev > 0 and latest is not None:
            growth = (latest - prev) / prev * 100
            if growth < -10:
                flags.append({
                    "severity":    "high",
                    "title":       "Revenue Decline",
                    "description": f"Revenue declined {abs(growth):.1f}% YoY — significant demand or market share concern.",
                    "ratio_key":   "revenue_growth",
                    "value":       round(growth, 1),
                })
            elif growth < 0:
                flags.append({
                    "severity":    "medium",
                    "title":       "Revenue Contraction",
                    "description": f"Revenue contracted {abs(growth):.1f}% YoY.",
                    "ratio_key":   "revenue_growth",
                    "value":       round(growth, 1),
                })

    # Sort: high first, then medium, then low
    order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda f: order.get(f["severity"], 3))
    return flags
