"""
GST returns analysis from a month-by-month summary sheet.

Input is the Excel (or CSV) summary a borrower's CA prepares from the filed
GSTR-3B returns: one row per tax period with the Table 3.1 outward supplies,
output tax, net ITC (Table 4(C)) and tax paid in cash (Table 6.1). An optional
"Customers" sheet carries customer-wise taxable value from GSTR-1 (B2B).

Everything here is deterministic arithmetic on the figures supplied. Nothing is
stored: the caller passes bytes in and gets a dict back.

Outputs:
  - Period covered, missing months, filing record against due dates
  - Turnover totals and monthly trend, growth, volatility, nil months, sharp drops
  - Output tax, ITC and cash-paid mix, effective tax rate sanity check
  - Export share, customer concentration
  - Reconciliation against turnover per financials and against bank credits
  - Severity-ranked flags and plain-language observations
"""
from __future__ import annotations

import io
import re
import logging
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Optional

import pandas as pd

logger = logging.getLogger(__name__)

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

# GST state codes (first two digits of a GSTIN).
STATE_CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
    "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
    "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
    "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
}

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Thresholds. Each one is stated in the flag text so an RM can see the rule.
RECON_WARN_PCT = 10.0
RECON_HIGH_PCT = 25.0
BANK_LOW_RATIO = 0.70
BANK_HIGH_RATIO = 1.50
DROP_PCT = 40.0
VOLATILITY_PCT = 35.0
TOP1_WARN = 25.0
TOP1_HIGH = 40.0
TOP5_WARN = 60.0


# ── Column detection ─────────────────────────────────────────────────────────

def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


# (field, test on normalised header). Order matters: specific before general.
_COLUMN_RULES: list[tuple[str, Any]] = [
    ("month", lambda h: h in ("month", "period", "taxperiod", "returnperiod", "monthyear") or h.startswith("month") or h.startswith("taxperiod") or h.startswith("returnperiod")),
    ("filed_on", lambda h: "filed" in h or "filing" in h or "dateoffiling" in h or h.startswith("arndate")),
    ("zero_rated", lambda h: "zero" in h or "export" in h or "31b" in h),
    ("exempt", lambda h: "nil" in h or "exempt" in h or "31c" in h),
    ("non_gst", lambda h: "nongst" in h or "31e" in h),
    ("reverse_charge", lambda h: "reverse" in h or "inward" in h or "31d" in h),
    ("customer_gstin", lambda h: h in ("gstin", "customergstin", "gstinofcustomer", "recipientgstin", "ctin")),
    ("customer_name", lambda h: h in ("customer", "customername", "name", "recipient", "recipientname", "party", "partyname", "tradename", "legalname")),
    ("igst", lambda h: "igst" in h or h.startswith("integratedtax")),
    ("cgst", lambda h: "cgst" in h or h.startswith("centraltax")),
    ("sgst", lambda h: "sgst" in h or "utgst" in h or h.startswith("statetax") or h.startswith("stateuttax")),
    ("cess", lambda h: h.startswith("cess") or h.endswith("cess")),
    ("output_tax", lambda h: "outputtax" in h or "taxliability" in h or "totaltax" in h or "taxpayable" in h),
    ("itc", lambda h: "itc" in h or "inputtaxcredit" in h),
    ("cash_paid", lambda h: "cash" in h),
    ("taxable", lambda h: "taxable" in h or "31a" in h or h.startswith("outwardsupplies") or h == "turnover"),
]


def _match_columns(headers: list[Any]) -> dict[str, int]:
    found: dict[str, int] = {}
    for idx, raw in enumerate(headers):
        h = _norm(raw)
        if not h or h.startswith("unnamed"):
            continue
        for fld, test in _COLUMN_RULES:
            if fld in found:
                continue
            try:
                if test(h):
                    found[fld] = idx
                    break
            except Exception:
                continue
    return found


# ── Value parsing ────────────────────────────────────────────────────────────

def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and v != v:  # NaN
            return None
        return float(v)
    s = str(v).strip()
    if not s or s in ("-", "—", "–", "nil", "NIL", "Nil", "NA", "N/A"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = re.sub(r"[^\d.\-]", "", s)
    if not s or s in ("-", ".", "-."):
        return None
    try:
        n = float(s)
    except ValueError:
        return None
    return -abs(n) if neg else n


def parse_month(v: Any) -> Optional[tuple[int, int]]:
    """Return (year, month) from the many ways a tax period gets written."""
    if v is None:
        return None
    if isinstance(v, (datetime, date, pd.Timestamp)):
        return (v.year, v.month)
    if isinstance(v, float) and v != v:
        return None
    s = str(v).strip()
    if not s:
        return None
    low = s.lower()

    # GST portal period code MMYYYY, e.g. 042025
    m = re.fullmatch(r"(\d{2})(\d{4})", s)
    if m and 1 <= int(m.group(1)) <= 12:
        return (int(m.group(2)), int(m.group(1)))
    # 2025-04, 2025/04, 2025-04-01
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[ t].*)?", low)
    if m and 1 <= int(m.group(2)) <= 12:
        return (int(m.group(1)), int(m.group(2)))
    # 04/2025, 4-2025
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{4})", s)
    if m and 1 <= int(m.group(1)) <= 12:
        return (int(m.group(2)), int(m.group(1)))
    # 01/04/2025 (day first, Indian convention)
    m = re.fullmatch(r"\d{1,2}[-/.](\d{1,2})[-/.](\d{4})", s)
    if m and 1 <= int(m.group(1)) <= 12:
        return (int(m.group(2)), int(m.group(1)))
    # Apr-2025, April 2025, Apr'25, Apr-25
    m = re.fullmatch(r"([a-z]{3,9})[\s\-'/,.]*(\d{2}|\d{4})", low)
    if m and m.group(1)[:3] in MONTHS:
        yr = int(m.group(2))
        if yr < 100:
            yr += 2000
        return (yr, MONTHS.index(m.group(1)[:3]) + 1)
    return None


def _parse_date(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, pd.Timestamp):
        return None if pd.isna(v) else v.date()
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, float) and v != v:
        return None
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%d/%m/%y", "%d-%b-%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def month_key(ym: tuple[int, int]) -> str:
    return f"{ym[0]:04d}-{ym[1]:02d}"


def month_label(ym: tuple[int, int]) -> str:
    return f"{MONTHS[ym[1] - 1].title()} {ym[0]}"


def _next_month(ym: tuple[int, int]) -> tuple[int, int]:
    y, m = ym
    return (y + 1, 1) if m == 12 else (y, m + 1)


def due_date(ym: tuple[int, int]) -> date:
    """GSTR-3B for a monthly filer is due on the 20th of the following month."""
    y, m = _next_month(ym)
    return date(y, m, 20)


# ── GSTIN ────────────────────────────────────────────────────────────────────

def gstin_check_char(gstin: str) -> str:
    total = 0
    for i, ch in enumerate(gstin[:14]):
        product = _GSTIN_CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += product // 36 + product % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36]


def inspect_gstin(raw: Optional[str]) -> Optional[dict]:
    if not raw or not str(raw).strip():
        return None
    g = re.sub(r"\s", "", str(raw)).upper()
    info: dict[str, Any] = {"gstin": g, "format_ok": bool(GSTIN_RE.match(g))}
    if info["format_ok"]:
        info["state_code"] = g[:2]
        info["state"] = STATE_CODES.get(g[:2], "Unknown state code")
        info["pan"] = g[2:12]
        info["check_digit_ok"] = gstin_check_char(g) == g[14]
    return info


# ── Parsing the workbook ─────────────────────────────────────────────────────

@dataclass
class MonthRow:
    ym: tuple[int, int]
    taxable: float = 0.0
    zero_rated: float = 0.0
    exempt: float = 0.0
    non_gst: float = 0.0
    output_tax: Optional[float] = None
    itc: Optional[float] = None
    cash_paid: Optional[float] = None
    filed_on: Optional[date] = None

    @property
    def turnover(self) -> float:
        return self.taxable + self.zero_rated + self.exempt + self.non_gst

    @property
    def gross_sales(self) -> float:
        """Invoice value: turnover plus the tax charged on it."""
        return self.turnover + (self.output_tax or 0.0)


@dataclass
class ParsedSheet:
    months: list[MonthRow]
    customers: list[dict] = field(default_factory=list)
    columns_found: list[str] = field(default_factory=list)
    duplicate_months: list[str] = field(default_factory=list)


def _read_frames(file_bytes: bytes, filename: str) -> dict[str, pd.DataFrame]:
    name = filename.lower()
    buf = io.BytesIO(file_bytes)
    if name.endswith(".csv"):
        try:
            return {"Sheet1": pd.read_csv(buf, header=None, dtype=object)}
        except UnicodeDecodeError:
            buf.seek(0)
            return {"Sheet1": pd.read_csv(buf, header=None, dtype=object, encoding="latin-1")}
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(buf, sheet_name=None, header=None, dtype=object)
    raise ValueError("Unsupported file type. Upload the GST summary as Excel (.xlsx) or CSV.")


def _find_header(df: pd.DataFrame, required: set[str], min_hits: int) -> Optional[tuple[int, dict[str, int]]]:
    for r in range(min(12, len(df))):
        cols = _match_columns(list(df.iloc[r].values))
        if required <= cols.keys() and len(cols) >= min_hits:
            return r, cols
    return None


def parse_workbook(file_bytes: bytes, filename: str) -> ParsedSheet:
    frames = _read_frames(file_bytes, filename)
    month_sheet: Optional[tuple[pd.DataFrame, int, dict[str, int]]] = None
    customer_sheet: Optional[tuple[pd.DataFrame, int, dict[str, int]]] = None

    for sheet_name, df in frames.items():
        if df is None or df.empty:
            continue
        low = sheet_name.lower()
        if "example" in low or "instruction" in low or "read me" in low or "readme" in low:
            continue
        if month_sheet is None:
            hit = _find_header(df, {"month", "taxable"}, 2)
            if hit:
                month_sheet = (df, hit[0], hit[1])
                continue
        if customer_sheet is None:
            hit = _find_header(df, {"taxable"}, 2)
            if hit and ("customer_name" in hit[1] or "customer_gstin" in hit[1]):
                customer_sheet = (df, hit[0], hit[1])

    if month_sheet is None:
        raise ValueError(
            "Couldn't find the monthly summary. The sheet needs a header row with a Month column and a "
            "Taxable outward supplies column — download the template to see the expected layout."
        )

    df, hdr, cols = month_sheet
    by_month: dict[tuple[int, int], MonthRow] = {}
    duplicates: list[str] = []

    def cell(row: pd.Series, fld: str) -> Any:
        return row.iloc[cols[fld]] if fld in cols and cols[fld] < len(row) else None

    for _, row in df.iloc[hdr + 1:].iterrows():
        ym = parse_month(cell(row, "month"))
        if ym is None:
            continue  # totals rows, notes, blanks
        taxable = _to_float(cell(row, "taxable"))
        rec = MonthRow(
            ym=ym,
            taxable=taxable or 0.0,
            zero_rated=_to_float(cell(row, "zero_rated")) or 0.0,
            exempt=_to_float(cell(row, "exempt")) or 0.0,
            non_gst=_to_float(cell(row, "non_gst")) or 0.0,
            itc=_to_float(cell(row, "itc")),
            cash_paid=_to_float(cell(row, "cash_paid")),
            filed_on=_parse_date(cell(row, "filed_on")),
        )
        if "output_tax" in cols:
            rec.output_tax = _to_float(cell(row, "output_tax"))
        else:
            parts = [_to_float(cell(row, f)) for f in ("igst", "cgst", "sgst", "cess") if f in cols]
            if any(p is not None for p in parts):
                rec.output_tax = sum(p for p in parts if p is not None)
        if ym in by_month:
            duplicates.append(month_label(ym))
        by_month[ym] = rec

    if not by_month:
        raise ValueError("The monthly summary has a header row but no rows with a recognisable month.")

    customers: list[dict] = []
    if customer_sheet is not None:
        cdf, chdr, ccols = customer_sheet
        for _, row in cdf.iloc[chdr + 1:].iterrows():
            val = _to_float(row.iloc[ccols["taxable"]]) if ccols["taxable"] < len(row) else None
            name = row.iloc[ccols["customer_name"]] if "customer_name" in ccols else None
            gstin = row.iloc[ccols["customer_gstin"]] if "customer_gstin" in ccols else None
            name = None if name is None or (isinstance(name, float) and name != name) else str(name).strip()
            gstin = None if gstin is None or (isinstance(gstin, float) and gstin != gstin) else str(gstin).strip().upper()
            if not val or val <= 0 or not (name or gstin):
                continue
            if name and name.lower() in ("total", "grand total"):
                continue
            aggregate = bool(name and re.match(r"^(all\s+)?others?\b|^other\s+customers\b|^balance\b", name.strip(), re.I))
            customers.append({"name": name or gstin, "gstin": gstin, "taxable_value": val, "aggregate": aggregate})

    return ParsedSheet(
        months=[by_month[k] for k in sorted(by_month)],
        customers=customers,
        columns_found=sorted(cols.keys()),
        duplicate_months=duplicates,
    )


# ── Analysis ─────────────────────────────────────────────────────────────────

def _r(v: Optional[float], d: int = 2) -> Optional[float]:
    return None if v is None else round(v, d)


def _pct(a: float, b: float) -> Optional[float]:
    return None if not b else (a / b) * 100.0


def _missing_months(months: list[tuple[int, int]]) -> list[str]:
    if not months:
        return []
    have = set(months)
    out, cur = [], months[0]
    while cur <= months[-1]:
        if cur not in have:
            out.append(month_label(cur))
        cur = _next_month(cur)
    return out


def _growth(rows: list[MonthRow]) -> Optional[dict]:
    t = [r.turnover for r in rows]
    if len(t) >= 24:
        last, prior = sum(t[-12:]), sum(t[-24:-12])
        if prior:
            return {"basis": "Last 12 months against the 12 before", "pct": _r(_pct(last - prior, prior), 1)}
    if len(t) >= 6:
        half = len(t) // 2
        first, second = sum(t[:half]), sum(t[-half:])
        if first:
            return {"basis": f"Last {half} months against the first {half}", "pct": _r(_pct(second - first, first), 1)}
    return None


def _sharp_drops(rows: list[MonthRow]) -> list[dict]:
    out = []
    for i in range(3, len(rows)):
        trailing = statistics.mean(r.turnover for r in rows[i - 3:i])
        if trailing > 0 and rows[i].turnover < trailing * (1 - DROP_PCT / 100):
            out.append({
                "month": month_label(rows[i].ym),
                "turnover": _r(rows[i].turnover),
                "trailing_3m_avg": _r(trailing),
                "drop_pct": _r(_pct(trailing - rows[i].turnover, trailing), 1),
            })
    return out


def _bank_credits_by_month(bank: dict) -> dict[str, float]:
    """Business-like credits per month: excludes cheque/ECS returns and investment redemptions."""
    excluded = {"Cheque/ECS Return", "Investment"}
    out: dict[str, float] = {}
    for t in bank.get("transactions", []):
        if t.get("type") != "Credit" or t.get("category") in excluded:
            continue
        k = str(t.get("date", ""))[:7]
        out[k] = out.get(k, 0.0) + float(t.get("credit") or 0.0)
    return out


def analyze_gst_returns(
    file_bytes: bytes,
    filename: str,
    legal_name: Optional[str] = None,
    gstin: Optional[str] = None,
    financials_turnover: Optional[float] = None,
    bank_analysis: Optional[dict] = None,
) -> dict:
    """
    Analyse a monthly GST summary. `financials_turnover` is revenue per the
    financial statements for the same period, in rupees. `bank_analysis` is the
    output of bank_statement.analyze_bank_statement for the same period.
    """
    parsed = parse_workbook(file_bytes, filename)
    rows = parsed.months
    yms = [r.ym for r in rows]

    total_turnover = sum(r.turnover for r in rows)
    total_taxable = sum(r.taxable for r in rows)
    total_zero = sum(r.zero_rated for r in rows)
    total_exempt = sum(r.exempt for r in rows)
    total_non_gst = sum(r.non_gst for r in rows)
    tax_known = [r for r in rows if r.output_tax is not None]
    total_output_tax = sum(r.output_tax or 0.0 for r in tax_known) if tax_known else None
    itc_known = [r for r in rows if r.itc is not None]
    total_itc = sum(r.itc or 0.0 for r in itc_known) if itc_known else None
    cash_known = [r for r in rows if r.cash_paid is not None]
    total_cash = sum(r.cash_paid or 0.0 for r in cash_known) if cash_known else None
    gross_sales = total_turnover + (total_output_tax or 0.0)

    monthly_turnover = [r.turnover for r in rows]
    avg_month = statistics.mean(monthly_turnover) if monthly_turnover else 0.0
    volatility = (statistics.pstdev(monthly_turnover) / avg_month * 100) if len(rows) >= 3 and avg_month else None
    nil_months = [month_label(r.ym) for r in rows if r.turnover == 0]
    peak = max(rows, key=lambda r: r.turnover)
    trough = min(rows, key=lambda r: r.turnover)

    # Filing record
    filings = []
    for r in rows:
        due = due_date(r.ym)
        delay = (r.filed_on - due).days if r.filed_on else None
        filings.append({
            "month": month_label(r.ym),
            "due": due.isoformat(),
            "filed_on": r.filed_on.isoformat() if r.filed_on else None,
            "delay_days": delay,
        })
    with_dates = [f for f in filings if f["delay_days"] is not None]
    late = [f for f in with_dates if f["delay_days"] > 0]

    # Customers
    concentration = None
    named = [c for c in parsed.customers if not c["aggregate"]]
    if named:
        # Aggregate rows ("Others") count toward the total but are never ranked as one customer.
        cust_total = sum(c["taxable_value"] for c in parsed.customers)
        others_value = sum(c["taxable_value"] for c in parsed.customers if c["aggregate"])
        ranked = sorted(named, key=lambda c: -c["taxable_value"])
        concentration = {
            "customers": len(ranked),
            "total_taxable_value": _r(cust_total),
            "others_value": _r(others_value) if others_value else None,
            "others_share_pct": _r(_pct(others_value, cust_total), 1) if others_value else None,
            "top": [
                {"name": c["name"], "gstin": c["gstin"], "taxable_value": _r(c["taxable_value"]), "share_pct": _r(_pct(c["taxable_value"], cust_total), 1)}
                for c in ranked[:10]
            ],
            "top1_share_pct": _r(_pct(ranked[0]["taxable_value"], cust_total), 1),
            "top5_share_pct": _r(_pct(sum(c["taxable_value"] for c in ranked[:5]), cust_total), 1),
        }

    # Reconciliation
    recon: dict[str, Any] = {}
    if financials_turnover:
        var = _pct(total_turnover - financials_turnover, financials_turnover)
        recon["financials"] = {
            "financials_turnover": _r(financials_turnover),
            "gst_turnover": _r(total_turnover),
            "variance_pct": _r(var, 1),
        }
    bank_monthly: dict[str, float] = {}
    if bank_analysis:
        bank_monthly = _bank_credits_by_month(bank_analysis)
        overlap = [r for r in rows if month_key(r.ym) in bank_monthly]
        if overlap:
            gst_gross = sum(r.gross_sales for r in overlap)
            bank_total = sum(bank_monthly[month_key(r.ym)] for r in overlap)
            recon["bank"] = {
                "months_compared": len(overlap),
                "period": f"{month_label(overlap[0].ym)} to {month_label(overlap[-1].ym)}",
                "gst_gross_sales": _r(gst_gross),
                "bank_credits": _r(bank_total),
                "ratio": _r(bank_total / gst_gross, 2) if gst_gross else None,
                "basis": "Bank credits exclude cheque/ECS returns and investment redemptions. GST gross sales include tax charged.",
            }
        else:
            recon["bank"] = {"months_compared": 0, "note": "The bank statement does not cover any month in the GST summary."}

    monthly = []
    for r in rows:
        k = month_key(r.ym)
        monthly.append({
            "month": k,
            "label": month_label(r.ym),
            "taxable": _r(r.taxable),
            "zero_rated": _r(r.zero_rated),
            "exempt": _r(r.exempt),
            "non_gst": _r(r.non_gst),
            "turnover": _r(r.turnover),
            "output_tax": _r(r.output_tax),
            "itc": _r(r.itc),
            "cash_paid": _r(r.cash_paid),
            "gross_sales": _r(r.gross_sales),
            "bank_credits": _r(bank_monthly[k]) if k in bank_monthly else None,
        })

    result: dict[str, Any] = {
        "taxpayer": {
            "legal_name": legal_name or None,
            "gstin": inspect_gstin(gstin),
            "filename": filename,
        },
        "period": {
            "from": month_label(yms[0]),
            "to": month_label(yms[-1]),
            "months": len(rows),
            "missing_months": _missing_months(yms),
            "duplicate_months": parsed.duplicate_months,
        },
        "columns_found": parsed.columns_found,
        "totals": {
            "turnover": _r(total_turnover),
            "taxable": _r(total_taxable),
            "zero_rated": _r(total_zero),
            "exempt": _r(total_exempt),
            "non_gst": _r(total_non_gst),
            "output_tax": _r(total_output_tax),
            "itc": _r(total_itc),
            "cash_paid": _r(total_cash),
            "gross_sales": _r(gross_sales),
            "average_monthly_turnover": _r(avg_month),
            "annualised_turnover": _r(avg_month * 12),
        },
        "ratios": {
            "export_share_pct": _r(_pct(total_zero, total_turnover), 1),
            "exempt_share_pct": _r(_pct(total_exempt + total_non_gst, total_turnover), 1),
            "effective_tax_rate_pct": _r(_pct(total_output_tax, total_taxable), 1) if total_output_tax is not None and total_taxable else None,
            "itc_to_output_pct": _r(_pct(total_itc, total_output_tax), 1) if total_itc is not None and total_output_tax else None,
            "cash_share_of_tax_pct": _r(_pct(total_cash, total_output_tax), 1) if total_cash is not None and total_output_tax else None,
            "volatility_pct": _r(volatility, 1),
        },
        "trend": {
            "growth": _growth(rows),
            "peak": {"month": month_label(peak.ym), "turnover": _r(peak.turnover)},
            "trough": {"month": month_label(trough.ym), "turnover": _r(trough.turnover)},
            "nil_months": nil_months,
            "sharp_drops": _sharp_drops(rows),
        },
        "filing": {
            "months_with_dates": len(with_dates),
            "late_count": len(late),
            "max_delay_days": max((f["delay_days"] for f in late), default=0),
            "average_delay_days": _r(statistics.mean(f["delay_days"] for f in late), 1) if late else 0,
            "basis": "Due on the 20th of the following month (monthly GSTR-3B filer). Quarterly (QRMP) filers have different due dates.",
            "items": filings,
        },
        "concentration": concentration,
        "reconciliation": recon,
        "monthly": monthly,
    }
    result["flags"] = build_flags(result)
    result["observations"] = build_observations(result)
    return result


# ── Flags and observations ───────────────────────────────────────────────────

def _cr(v: Optional[float]) -> str:
    if v is None:
        return "—"
    if abs(v) >= 1e7:
        return f"₹{v / 1e7:,.2f} Cr"
    return f"₹{v / 1e5:,.2f} lakh"


def build_flags(a: dict) -> list[dict]:
    flags: list[dict] = []

    def add(severity: str, title: str, detail: str) -> None:
        flags.append({"severity": severity, "title": title, "detail": detail})

    rec = a["reconciliation"]
    fin = rec.get("financials")
    if fin and fin.get("variance_pct") is not None:
        v = fin["variance_pct"]
        if abs(v) > RECON_WARN_PCT:
            add(
                "high" if abs(v) > RECON_HIGH_PCT else "medium",
                "GST turnover differs from the financials",
                f"GST returns show {_cr(fin['gst_turnover'])} against {_cr(fin['financials_turnover'])} in the financials, "
                f"a {abs(v):.1f}% {'excess' if v > 0 else 'shortfall'}. Differences above {RECON_WARN_PCT:.0f}% need an explanation "
                "(stock transfers, other income, period mismatch).",
            )
    bank = rec.get("bank")
    if bank and bank.get("ratio") is not None:
        ratio = bank["ratio"]
        if ratio < BANK_LOW_RATIO:
            add("high" if ratio < 0.5 else "medium", "Sales not routed through this bank account",
                f"Bank credits are {ratio:.0%} of GST gross sales over {bank['months_compared']} months. Collections may run through "
                "other accounts, or reported sales may not be realised. Ask for all operative account statements.")
        elif ratio > BANK_HIGH_RATIO:
            add("high" if ratio > 2 else "medium", "Bank credits well above declared sales",
                f"Bank credits are {ratio:.0%} of GST gross sales over {bank['months_compared']} months. Check for loan disbursals, "
                "inter-company or circular transfers, and unreported sales.")

    period = a["period"]
    if period["missing_months"]:
        add("medium" if len(period["missing_months"]) > 1 else "low", "Months missing from the summary",
            f"No figures for {', '.join(period['missing_months'][:6])}{'…' if len(period['missing_months']) > 6 else ''}. "
            "Confirm whether returns were filed for these periods.")
    if period["duplicate_months"]:
        add("low", "Months entered twice", f"{', '.join(period['duplicate_months'])} appear more than once; the last row was used.")

    tr = a["trend"]
    if tr["nil_months"]:
        add("medium", "Nil turnover months", f"Turnover was nil in {', '.join(tr['nil_months'][:6])}.")
    for d in tr["sharp_drops"][:3]:
        add("medium", f"Turnover fell sharply in {d['month']}",
            f"{_cr(d['turnover'])} against a three-month average of {_cr(d['trailing_3m_avg'])}, down {d['drop_pct']:.0f}%.")
    g = tr.get("growth")
    if g and g["pct"] is not None and g["pct"] <= -15:
        add("high" if g["pct"] <= -30 else "medium", "Declining turnover", f"{g['basis']}: {g['pct']:+.1f}%.")

    ratios = a["ratios"]
    if ratios["volatility_pct"] is not None and ratios["volatility_pct"] > VOLATILITY_PCT:
        add("low", "Uneven monthly turnover",
            f"Month-to-month variation is {ratios['volatility_pct']:.0f}% of the average. Check whether the business is seasonal before reading it as risk.")
    if ratios["itc_to_output_pct"] is not None:
        itc = ratios["itc_to_output_pct"]
        if itc > 100:
            add("medium", "Input tax credit exceeds output tax",
                f"ITC claimed is {itc:.0f}% of output tax. Expected for an inverted duty structure or exporter; otherwise verify ITC against GSTR-2B.")
        elif itc >= 95:
            add("low", "Very little value added on tax",
                f"ITC covers {itc:.0f}% of output tax, so almost all tax is set off. Typical of thin-margin trading; worth confirming against margins in the financials.")
    etr = ratios["effective_tax_rate_pct"]
    if etr is not None and (etr <= 0 or etr > 40):
        add("medium", "Output tax looks inconsistent with turnover",
            f"Output tax is {etr:.1f}% of taxable supplies, outside the range GST rates allow. Check the tax columns in the summary.")

    f = a["filing"]
    if f["late_count"]:
        sev = "high" if f["late_count"] >= 4 or f["max_delay_days"] > 60 else "medium" if f["late_count"] >= 2 or f["max_delay_days"] > 15 else "low"
        add(sev, "Returns filed late",
            f"{f['late_count']} of {f['months_with_dates']} returns were filed after the due date, the longest by {f['max_delay_days']} days.")

    c = a["concentration"]
    if c:
        if c["top1_share_pct"] is not None and c["top1_share_pct"] > TOP1_WARN:
            add("high" if c["top1_share_pct"] > TOP1_HIGH else "medium", "Dependence on one customer",
                f"{c['top'][0]['name']} accounts for {c['top1_share_pct']:.0f}% of B2B taxable value.")
        elif c["top5_share_pct"] is not None and c["top5_share_pct"] > TOP5_WARN and c["customers"] > 5:
            add("medium", "Concentrated customer base", f"The top five customers account for {c['top5_share_pct']:.0f}% of B2B taxable value.")

    gi = a["taxpayer"]["gstin"]
    if gi:
        if not gi["format_ok"]:
            add("medium", "GSTIN format is not valid", f"{gi['gstin']} does not match the 15-character GSTIN pattern.")
        elif not gi.get("check_digit_ok"):
            add("low", "GSTIN check digit does not match", f"Verify {gi['gstin']} on the GST portal; it may have been mistyped.")

    order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda x: order[x["severity"]])
    return flags


def build_observations(a: dict) -> list[str]:
    obs: list[str] = []
    t, p, r = a["totals"], a["period"], a["ratios"]
    obs.append(
        f"Total outward supplies of {_cr(t['turnover'])} over {p['months']} month{'s' if p['months'] != 1 else ''} "
        f"({p['from']} to {p['to']}), an average of {_cr(t['average_monthly_turnover'])} a month."
    )
    g = a["trend"].get("growth")
    if g and g["pct"] is not None:
        obs.append(f"{g['basis']}: turnover {'up' if g['pct'] >= 0 else 'down'} {abs(g['pct']):.1f}%.")
    if r["export_share_pct"]:
        obs.append(f"Exports and other zero-rated supplies are {r['export_share_pct']:.1f}% of turnover.")
    if r["itc_to_output_pct"] is not None and r["cash_share_of_tax_pct"] is not None:
        obs.append(f"Input tax credit set off {r['itc_to_output_pct']:.0f}% of output tax; {r['cash_share_of_tax_pct']:.0f}% was paid in cash.")
    f = a["filing"]
    if f["months_with_dates"]:
        obs.append(
            "All returns with a filing date were filed on time." if not f["late_count"]
            else f"{f['late_count']} of {f['months_with_dates']} returns were filed late."
        )
    bank = a["reconciliation"].get("bank")
    if bank and bank.get("ratio") is not None:
        obs.append(f"Bank credits cover {bank['ratio']:.0%} of GST gross sales for {bank['period']}.")
    fin = a["reconciliation"].get("financials")
    if fin and fin.get("variance_pct") is not None:
        obs.append(f"GST turnover is within {abs(fin['variance_pct']):.1f}% of the financials." if abs(fin["variance_pct"]) <= RECON_WARN_PCT
                   else f"GST turnover differs from the financials by {fin['variance_pct']:+.1f}%.")
    return obs


# ── Template ─────────────────────────────────────────────────────────────────

TEMPLATE_HEADERS = [
    "Month",
    "Taxable outward supplies (3.1a)",
    "Zero-rated supplies / exports (3.1b)",
    "Nil-rated and exempt supplies (3.1c)",
    "Non-GST supplies (3.1e)",
    "IGST",
    "CGST",
    "SGST / UTGST",
    "Cess",
    "Net ITC availed (4C)",
    "Tax paid in cash (6.1)",
    "Return filed on",
]
CUSTOMER_HEADERS = ["Customer name", "GSTIN", "Taxable value"]


def build_template() -> bytes:
    """An empty monthly sheet, an optional customers sheet, instructions and a labelled example."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="13202F")

    def header(ws, cols: list[str]) -> None:
        ws.append(cols)
        for i, _ in enumerate(cols, start=1):
            c = ws.cell(row=1, column=i)
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(wrap_text=True, vertical="center")
            ws.column_dimensions[get_column_letter(i)].width = 16 if i > 1 else 12
        ws.row_dimensions[1].height = 42
        ws.freeze_panes = "B2"

    ws = wb.active
    ws.title = "Monthly summary"
    header(ws, TEMPLATE_HEADERS)

    cs = wb.create_sheet("Customers")
    header(cs, CUSTOMER_HEADERS)
    cs.column_dimensions["A"].width = 34
    cs.column_dimensions["B"].width = 20

    ins = wb.create_sheet("Instructions")
    for line in [
        "GST summary for CreditGuard",
        "",
        "Monthly summary: one row per tax period, figures in rupees, taken from the filed GSTR-3B.",
        "Month: any of Apr-2025, April 2025, 2025-04 or 042025.",
        "Supplies columns follow GSTR-3B Table 3.1. Leave a column blank if it does not apply.",
        "Tax: IGST, CGST, SGST/UTGST and Cess separately, or replace them with one 'Total output tax' column.",
        "Net ITC availed is Table 4(C). Tax paid in cash is the cash column of Table 6.1.",
        "Return filed on: the date the GSTR-3B was filed (DD/MM/YYYY). Used to check filing discipline.",
        "",
        "Customers (optional): customer-wise taxable value for the same period from GSTR-1 (B2B).",
        "",
        "The 'Example' sheet shows the layout with made-up figures. It is ignored when the file is analysed.",
    ]:
        ins.append([line])
    ins["A1"].font = Font(bold=True, size=13)
    ins.column_dimensions["A"].width = 110

    ex = wb.create_sheet("Example")
    header(ex, TEMPLATE_HEADERS)
    base = [412, 398, 455, 470, 433, 520, 498, 610, 585, 548, 502, 640]
    for i, lakh in enumerate(base):
        y, m = (2025, 4 + i) if i < 9 else (2026, i - 8)
        taxable = lakh * 1e5
        zero = round(taxable * 0.08)
        ex.append([
            f"{MONTHS[m - 1].title()}-{y}", taxable, zero, 0, 0,
            round(taxable * 0.10), round(taxable * 0.04), round(taxable * 0.04), 0,
            round(taxable * 0.15), round(taxable * 0.03),
            (due_date((y, m)) - timedelta(days=2)).strftime("%d/%m/%Y"),
        ])
    ex.append(["Made-up figures for illustration only."])
    return _save(wb)


def _save(wb) -> bytes:
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
