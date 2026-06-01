"""Render deterministic CAM tables as GitHub-flavoured Markdown. No LLM, no I/O.

Figures are formatted in Indian (lakh-crore) digit grouping, whole rupees-crore.
"""
from finance_utils import as_number

# (ratio_key, label, operator, threshold, unit) — default mid-corporate covenants.
COVENANTS = [
    ("tol_tnw",                 "TOL/TNW",           "<=", 3.00, "x"),
    ("debt_equity",             "Debt/Equity",       "<=", 2.00, "x"),
    ("dscr",                    "DSCR",              ">=", 1.25, "x"),
    ("interest_coverage_ratio", "Interest Coverage", ">=", 2.00, "x"),
    ("current_ratio",           "Current Ratio",     ">=", 1.33, "x"),
]


def _inr(v) -> str:
    """Indian-grouped whole number, e.g. 140933 -> '1,40,933'. Non-numeric -> em dash."""
    n = as_number(v)
    if n is None:
        return "—"
    neg = n < 0
    s = str(abs(int(round(n))))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + s


def financial_spread(fin: dict) -> str:
    """Multi-year CMA-style spread with years as columns (₹ Cr)."""
    pl = fin.get("profit_loss", {}) or {}
    bs = fin.get("balance_sheet", {}) or {}
    years = pl.get("years") or bs.get("years") or []
    if not years:
        return ""
    rows = [
        ("Revenue from Operations", pl.get("revenue")),
        ("EBITDA",                  pl.get("ebitda")),
        ("PBT",                     pl.get("pbt")),
        ("PAT",                     pl.get("pat")),
        ("Net Worth (TNW)",         bs.get("total_equity")),
        ("Total Debt",              bs.get("borrowings")),
    ]
    head = "| Particulars (₹ Cr) | " + " | ".join(years) + " |"
    sep = "|" + "---|" * (len(years) + 1)
    body = []
    for label, arr in rows:
        arr = arr if isinstance(arr, list) else []
        cells = [_inr(arr[i]) if i < len(arr) else "—" for i in range(len(years))]
        body.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join([head, sep, *body])


def ratio_covenant_table(ratios: dict) -> str:
    """Key ratios vs default covenants with pass/breach status."""
    ratios = ratios or {}
    rows = []
    for key, label, op, thr, unit in COVENANTS:
        v = as_number(ratios.get(key))
        if v is None:
            continue
        within = (v <= thr) if op == "<=" else (v >= thr)
        est = " (est.)" if key == "dscr" and ratios.get("dscr_estimated") else ""
        status = "✓ Within" if within else "✗ Breach"
        rows.append(f"| {label} | {v:.2f}{unit}{est} | {op} {thr:.2f}{unit} | {status} |")
    if not rows:
        return ""
    head = "| Ratio | Actual | Covenant | Status |"
    sep = "|---|---|---|---|"
    return "\n".join([head, sep, *rows])
