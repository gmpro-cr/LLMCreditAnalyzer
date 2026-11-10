"""GST summary analysis: parsing variants, metrics, flags, reconciliation."""
import io

import pytest
from openpyxl import Workbook, load_workbook

import gst_returns as g


def _xlsx(rows, headers=None, title_rows=(), customers=None, sheet="Sheet1"):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    for t in title_rows:
        ws.append(t)
    ws.append(headers or ["Month", "Taxable value", "IGST", "CGST", "SGST", "ITC", "Cash paid", "Filed on"])
    for r in rows:
        ws.append(r)
    if customers:
        cs = wb.create_sheet("Customers")
        cs.append(["Customer name", "GSTIN", "Taxable value"])
        for c in customers:
            cs.append(c)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _year(start=(2025, 4), lakh=None, filed_offset=-2):
    lakh = lakh or [100] * 12
    rows, ym = [], start
    for v in lakh:
        due = g.due_date(ym)
        rows.append([f"{g.MONTHS[ym[1]-1].title()}-{ym[0]}", v * 1e5, v * 1e5 * 0.18, 0, 0,
                     v * 1e5 * 0.15, v * 1e5 * 0.03,
                     due.replace(day=20 + filed_offset).strftime("%d/%m/%Y") if filed_offset <= 0 else
                     (due + __import__("datetime").timedelta(days=filed_offset)).strftime("%d/%m/%Y")])
        ym = g._next_month(ym)
    return rows


# ── month parsing ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("Apr-2025", (2025, 4)), ("April 2025", (2025, 4)), ("Apr'25", (2025, 4)), ("apr-25", (2025, 4)),
    ("2025-04", (2025, 4)), ("2025/04/01", (2025, 4)), ("04/2025", (2025, 4)), ("042025", (2025, 4)),
    ("01/04/2025", (2025, 4)), ("Total", None), ("", None), (None, None),
])
def test_parse_month(raw, expected):
    assert g.parse_month(raw) == expected


def test_due_date_rolls_year():
    assert g.due_date((2025, 12)).isoformat() == "2026-01-20"


# ── GSTIN ────────────────────────────────────────────────────────────────────

def test_gstin_published_samples_pass_check_digit():
    for sample in ("27AAPFU0939F1ZV", "29AAGCB7383J1Z4"):
        info = g.inspect_gstin(sample)
        assert info["format_ok"] and info["check_digit_ok"]
    info = g.inspect_gstin("27AAPFU0939F1ZV")
    assert info["state"] == "Maharashtra" and info["pan"] == "AAPFU0939F"


def test_gstin_bad_format_and_bad_check_digit():
    assert g.inspect_gstin("27ABC")["format_ok"] is False
    tampered = g.inspect_gstin("27AAPFU0939F1ZA")
    assert tampered["format_ok"] and tampered["check_digit_ok"] is False


# ── template round trip ──────────────────────────────────────────────────────

def test_template_is_ignored_when_empty_and_example_sheet_is_skipped():
    tpl = g.build_template()
    wb = load_workbook(io.BytesIO(tpl))
    assert wb.sheetnames == ["Monthly summary", "Customers", "Instructions", "Example"]
    with pytest.raises(ValueError, match="no rows with a recognisable month"):
        g.analyze_gst_returns(tpl, "template.xlsx")


def test_template_filled_from_example_analyses_cleanly():
    tpl = load_workbook(io.BytesIO(g.build_template()))
    ex, ms = tpl["Example"], tpl["Monthly summary"]
    for row in ex.iter_rows(min_row=2, values_only=True):
        if row[1] is not None:
            ms.append(list(row))
    out = io.BytesIO(); tpl.save(out)
    a = g.analyze_gst_returns(out.getvalue(), "filled.xlsx", gstin="27AAPFU0939F1ZV")
    assert a["period"]["months"] == 12 and a["period"]["missing_months"] == []
    assert a["ratios"]["export_share_pct"] == pytest.approx(7.4, abs=0.1)
    assert a["ratios"]["effective_tax_rate_pct"] == pytest.approx(18.0, abs=0.1)
    assert a["filing"]["late_count"] == 0
    assert not [f for f in a["flags"] if f["severity"] == "high"]


# ── messy CA-style sheets ────────────────────────────────────────────────────

def test_title_rows_totals_row_and_total_tax_column():
    rows = [["042025", "10,00,000", "1,80,000", "1,50,000", "30,000"],
            ["052025", "12,00,000", "2,16,000", "1,80,000", "36,000"],
            ["Total", "22,00,000", "3,96,000", "3,30,000", "66,000"]]
    data = _xlsx(rows, headers=["Tax period", "Taxable turnover", "Total tax liability", "Input tax credit", "Tax paid in cash"],
                 title_rows=[["ABC Traders Pvt Ltd — GST summary FY 2025-26"], []])
    a = g.analyze_gst_returns(data, "ca.xlsx")
    assert a["period"]["months"] == 2
    assert a["totals"]["turnover"] == 2_200_000
    assert a["totals"]["output_tax"] == 396_000
    assert a["ratios"]["cash_share_of_tax_pct"] == pytest.approx(16.7, abs=0.1)


def test_csv_with_bracket_negatives():
    csv = "Month,Taxable value,Total output tax\nApr-2025,500000,90000\nMay-2025,(20000),-3600\n".encode()
    a = g.analyze_gst_returns(csv, "s.csv")
    assert a["monthly"][1]["taxable"] == -20000


def test_no_month_column_is_a_clear_error():
    data = _xlsx([["x", 1]], headers=["Name", "Amount"])
    with pytest.raises(ValueError, match="download the template"):
        g.analyze_gst_returns(data, "bad.xlsx")


def test_unsupported_extension():
    with pytest.raises(ValueError, match="Excel"):
        g.analyze_gst_returns(b"%PDF-1.7" + b"0" * 300, "3b.pdf")


# ── metrics and flags ────────────────────────────────────────────────────────

def _flag(a, title_part):
    return next((f for f in a["flags"] if title_part.lower() in f["title"].lower()), None)


def test_missing_month_and_nil_month_and_sharp_drop():
    rows = _year()
    del rows[5]                      # Sep-2025 missing
    rows[8][1:7] = [0, 0, 0, 0, 0, 0]  # a nil month
    a = g.analyze_gst_returns(_xlsx(rows), "s.xlsx")
    assert a["period"]["missing_months"] == ["Sep 2025"]
    assert _flag(a, "missing")
    assert _flag(a, "nil turnover")
    assert _flag(a, "fell sharply")


def test_growth_twelve_on_twelve():
    rows = _year(lakh=[100] * 12) + _year(start=(2026, 4), lakh=[80] * 12)
    a = g.analyze_gst_returns(_xlsx(rows), "s.xlsx")
    assert a["trend"]["growth"]["pct"] == -20.0
    assert _flag(a, "declining")["severity"] == "medium"


def test_late_filing_severity():
    a = g.analyze_gst_returns(_xlsx(_year(filed_offset=20)), "s.xlsx")
    f = _flag(a, "filed late")
    assert a["filing"]["late_count"] == 12 and f["severity"] == "high"


def test_itc_above_output_tax():
    rows = _year()
    for r in rows:
        r[5] = r[2] * 1.3  # ITC column > IGST (the only tax)
    a = g.analyze_gst_returns(_xlsx(rows), "s.xlsx")
    assert _flag(a, "exceeds output tax")


def test_customer_concentration():
    custs = [["Big Buyer Ltd", "27AAPFU0939F1ZV", 6_000_000], ["Small Co", "", 1_000_000], ["Total", "", 7_000_000]]
    a = g.analyze_gst_returns(_xlsx(_year(), customers=custs), "s.xlsx")
    c = a["concentration"]
    assert c["customers"] == 2 and c["top1_share_pct"] == pytest.approx(85.7, abs=0.1)
    assert _flag(a, "one customer")["severity"] == "high"


# ── reconciliation ───────────────────────────────────────────────────────────

def test_financials_variance():
    a = g.analyze_gst_returns(_xlsx(_year()), "s.xlsx", financials_turnover=10e7)  # GST 12 Cr vs 10 Cr
    assert a["reconciliation"]["financials"]["variance_pct"] == 20.0
    assert _flag(a, "differs from the financials")["severity"] == "medium"


def test_bank_reconciliation_excludes_returns_and_flags_low_routing():
    rows = _year(lakh=[100] * 3)  # Apr-Jun 2025, gross sales 118 lakh a month
    bank = {"transactions": [
        {"date": "2025-04-10", "type": "Credit", "category": "Other Credit", "credit": 50e5},
        {"date": "2025-05-10", "type": "Credit", "category": "Other Credit", "credit": 50e5},
        {"date": "2025-05-11", "type": "Credit", "category": "Cheque/ECS Return", "credit": 99e5},
        {"date": "2025-06-10", "type": "Credit", "category": "Investment", "credit": 99e5},
        {"date": "2025-06-12", "type": "Debit", "category": "Other Debit", "debit": 10e5},
        {"date": "2025-08-01", "type": "Credit", "category": "Other Credit", "credit": 10e5},
    ]}
    a = g.analyze_gst_returns(_xlsx(rows), "s.xlsx", bank_analysis=bank)
    b = a["reconciliation"]["bank"]
    assert b["months_compared"] == 2  # June has no business credits, August is outside
    assert b["bank_credits"] == 100e5
    assert b["ratio"] == pytest.approx(100 / 236, abs=0.01)
    assert _flag(a, "not routed")["severity"] == "high"
    assert a["monthly"][0]["bank_credits"] == 50e5


def test_bank_with_no_overlap():
    bank = {"transactions": [{"date": "2020-01-10", "type": "Credit", "category": "Other Credit", "credit": 1}]}
    a = g.analyze_gst_returns(_xlsx(_year()), "s.xlsx", bank_analysis=bank)
    assert a["reconciliation"]["bank"]["months_compared"] == 0


def test_others_row_counts_in_total_but_is_not_ranked():
    custs = [["Others (14 customers)", "", 9_000_000], ["Anchor Buyer", "", 3_000_000], ["Second", "", 1_000_000]]
    a = g.analyze_gst_returns(_xlsx(_year(), customers=custs), "s.xlsx")
    c = a["concentration"]
    assert [t["name"] for t in c["top"]] == ["Anchor Buyer", "Second"]
    assert c["customers"] == 2 and c["others_share_pct"] == pytest.approx(69.2, abs=0.1)
    assert c["top1_share_pct"] == pytest.approx(23.1, abs=0.1)
