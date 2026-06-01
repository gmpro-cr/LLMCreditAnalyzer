# Credit Integrity & Tabulated CAM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make CreditGuard AI's numbers correct and trustworthy, and render the CAM note with proper financial tables — at ₹0 (harden the existing free stack; no new paid services).

**Architecture:** All fixes are in the Python engine (`python-service/`) plus light React changes. Deterministic figures (spreads, ratios, tables) are computed in Python and injected into the memo verbatim; the LLM writes narrative only. A new validation gate blocks over-confident output when data is incomplete.

**Tech Stack:** Python 3.13, FastAPI, pytest (to be added), React 19 + react-markdown/remark-gfm (already present).

**Scope guardrails (DRY/YAGNI):** No new data vendors, no schema migration, no new endpoints. Fix root causes, add tests, keep diffs minimal.

**Default covenant set** (typical Indian mid-corporate norms; centralised so it's tunable):
| Ratio | Operator | Threshold |
|---|---|---|
| TOL/TNW | ≤ | 3.00 |
| Debt/Equity | ≤ | 2.00 |
| DSCR | ≥ | 1.25 |
| Interest Coverage | ≥ | 2.00 |
| Current Ratio | ≥ | 1.33 |

---

## Phase 0 — Test harness bootstrap

### Task 0: Add pytest + a real-data fixture

**Files:**
- Modify: `python-service/requirements.txt`
- Create: `python-service/tests/__init__.py`
- Create: `python-service/tests/conftest.py`
- Create: `python-service/tests/fixtures/tatasteel_screener.json`

**Step 1:** Append to `requirements.txt`:
```
pytest>=8.0.0
```

**Step 2:** Install: `cd python-service && venv/bin/pip install pytest`
Expected: `Successfully installed pytest-8.x`

**Step 3:** Save the already-captured live payload as the fixture (ground truth for regression):
```bash
cp /tmp/cg_memo.json python-service/tests/fixtures/tatasteel_screener_full.json
```
Then create `tests/fixtures/tatasteel_screener.json` = just the `financials` object from that file (the scraped Screener dict, *including* the `pat: "Dividend Yield..."` bug so tests prove the fix).

**Step 4:** `tests/conftest.py`:
```python
import json, pathlib, pytest
FIX = pathlib.Path(__file__).parent / "fixtures"

@pytest.fixture
def tatasteel_financials():
    return json.loads((FIX / "tatasteel_screener.json").read_text())
```

**Step 5:** Commit.
```bash
git add python-service/requirements.txt python-service/tests
git commit -m "test: bootstrap pytest + Tata Steel screener fixture"
```

---

## Phase 1 — Data integrity (extraction)

### Task 1: Fix the PAT variable-shadowing bug (root cause of garbage PAT)

`public_data.py:204` sets `pat = _ys("Net Profit")` (the array). `public_data.py:270` then does `for pat, key in patterns:` — reusing the name `pat`, which overwrites the Net Profit array with the last regex string `'Dividend Yield\s+([\d.]+)'`.

**Files:**
- Test: `python-service/tests/test_public_data.py`
- Modify: `python-service/public_data.py:262-272`

**Step 1: Write the failing test**
```python
# tests/test_public_data.py
import re
from public_data import _parse_top_metrics  # rename target in Step 3 if needed

def test_pat_is_not_clobbered_by_regex_loop(monkeypatch):
    # After parsing, the Net Profit array must remain numeric, never a regex string.
    from public_data import fetch_screener_financials
    # Use a saved Screener HTML fixture if available; otherwise assert via unit on the loop.
    sample_text = "Dividend Yield 1.20 %"
    # The regex loop must use a loop var named `pattern`, not `pat`.
    src = open("public_data.py").read()
    assert "for pat, key in patterns" not in src, "loop var `pat` shadows Net Profit array"
```

**Step 2: Run — expect FAIL**
`cd python-service && venv/bin/python -m pytest tests/test_public_data.py -v`
Expected: FAIL (the shadowing string is still present).

**Step 3: Fix — rename the loop variable**
In `public_data.py` around line 270, change:
```python
        for pat, key in patterns:
            m = re.search(pat, text, re.IGNORECASE)
```
to:
```python
        for pattern, key in patterns:
            m = re.search(pattern, text, re.IGNORECASE)
```
(Confirm no other `pat` reference inside that loop body; the Net Profit array `pat` from line 204 is now preserved.)

**Step 4: Run — expect PASS.**

**Step 5: Commit**
```bash
git add python-service/public_data.py python-service/tests/test_public_data.py
git commit -m "fix: stop regex loop var shadowing Net Profit array (PAT corruption)"
```

### Task 2: PAT fallback derivation when scrape still fails

**Files:**
- Test: `python-service/tests/test_pat_fallback.py`
- Create: `python-service/finance_utils.py`
- Modify: `public_data.py` (after the `pat` array is built, before the return ~line 429)

**Step 1: Failing test**
```python
# tests/test_pat_fallback.py
from finance_utils import derive_pat

def test_pat_from_eps_and_shares():
    # EPS 12.87, share capital 1249 (FV ₹1) → ~16,075 Cr
    assert round(derive_pat(eps=12.87, share_capital_cr=1249, face_value=1)) == 16075

def test_pat_from_pbt_when_no_eps():
    # PBT 21353, effective tax 25% → 16,015 Cr
    assert round(derive_pat(pbt=21353, effective_tax=0.25)) == 16015
```

**Step 2: Run — FAIL (no module).**

**Step 3: Implement `finance_utils.py`**
```python
"""Pure helpers for deriving missing credit figures. No I/O, no LLM."""
from typing import Optional

def derive_pat(eps: Optional[float] = None, share_capital_cr: Optional[float] = None,
               face_value: float = 1.0, pbt: Optional[float] = None,
               effective_tax: float = 0.25) -> Optional[float]:
    """Best-effort PAT (₹ Cr). Prefer EPS×shares; else PBT×(1−tax)."""
    if eps and share_capital_cr and face_value:
        shares_cr = share_capital_cr / face_value      # crore shares
        return eps * shares_cr                          # ₹ Cr
    if pbt:
        return pbt * (1 - effective_tax)
    return None
```

**Step 4:** In `public_data.py`, after building `pat` (array) and `eps`, add a guard so a non-numeric/empty latest PAT is repaired:
```python
from finance_utils import derive_pat
# Repair latest PAT if missing/non-numeric
if (not pat) or (not isinstance(pat[-1], (int, float))):
    fv = 1.0
    derived = derive_pat(eps=(eps[-1] if eps else None),
                         share_capital_cr=(equity_capital[-1] if equity_capital else None),
                         face_value=fv,
                         pbt=(pbt[-1] if pbt else None))
    if derived is not None:
        pat = (pat or []) + [round(derived)]
        # mark provenance so the memo can disclose it
        derived_flags["pat"] = "derived"
```

**Step 5:** Run both tests → PASS. Commit.
```bash
git commit -am "feat: derive PAT from EPS×shares or PBT when scrape fails"
```

### Task 3: Fix Free Cash Flow (currently ≈OCF, ~5× overstated)

Live output: `free_cash_flow[-1]=31,966` while `OCF=31,961`, `investing=−25,663` → correct FCF ≈ 6,298.

**Files:**
- Test: `tests/test_fcf.py`
- Modify: `public_data.py` where `free_cash_flow` (`fcf`) is assembled (~line 498)

**Step 1: Failing test**
```python
# tests/test_fcf.py
from finance_utils import free_cash_flow
def test_fcf_is_ocf_minus_capex():
    assert free_cash_flow(ocf=31961, capex=25663) == 6298
```

**Step 2:** Run → FAIL.

**Step 3:** Add to `finance_utils.py`:
```python
def free_cash_flow(ocf: float, capex: float) -> float:
    """FCF = Operating Cash Flow − Capex (capex passed as a positive magnitude)."""
    return round(ocf - abs(capex))
```
Then in `public_data.py`, stop trusting the scraped `fcf`; compute it: `fcf = [free_cash_flow(o, abs(i)) for o, i in zip(operating, investing)]` (use capex if a discrete capex line is available; else net investing as the conservative proxy, and label it).

**Step 4:** Run → PASS. **Step 5:** Commit `fix: compute FCF as OCF−capex instead of mislabelled scrape`.

### Task 4: Numeric sanitiser guard

**Files:** `tests/test_sanitise.py`, `finance_utils.py`

**Step 1:** Test:
```python
from finance_utils import as_number
def test_rejects_regex_and_punctuation():
    assert as_number("Dividend Yield\\s+([\\d.]+)") is None
    assert as_number(")") is None
    assert as_number("1,234.5") == 1234.5
    assert as_number(15683.0) == 15683.0
```

**Step 2:** FAIL. **Step 3:** Implement:
```python
import re as _re
def as_number(v):
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if _re.fullmatch(r"-?\d+(\.\d+)?", s): return float(s)
    return None
```
**Step 4:** PASS. **Step 5:** Commit. (Use `as_number` to gate any scraped value that lands in a numeric field.)

---

## Phase 2 — Ratio correctness

### Task 5: Fix TOL/TNW (systematic +1.0 error)

`ratios.py:194` divides total *balance-sheet* liabilities (which include equity) by equity. TOL must exclude net worth. Robust, source-independent definition: **TOL = Total Assets − Net Worth**.

**Files:** `tests/test_ratios.py`, modify `ratios.py:191-194`

**Step 1: Failing test**
```python
# tests/test_ratios.py
from ratios import calculate_ratios

def test_tol_tnw_excludes_networth(tatasteel_financials):
    r = calculate_ratios(tatasteel_financials)
    # TA=272747, NW=135534 → TOL=137213 → 1.01
    assert r["tol_tnw"] == 1.01
```

**Step 2:** Run → FAIL (currently 2.01).

**Step 3:** Replace the leverage block:
```python
    # ── LEVERAGE ──
    if equity > 0:
        ratios["debt_equity"] = round(_div(total_debt, equity), 2)
        # Total Outside Liabilities = Total Assets − Net Worth (excludes equity)
        tol = (total_assets - equity) if total_assets > equity else max(total_liab - equity, 0)
        ratios["tol_tnw"] = round(_div(tol, equity), 2)
```

**Step 4:** Run → PASS. **Step 5:** Commit `fix: TOL/TNW must exclude net worth (was overstated by 1.0)`.

### Task 6: Fix DSCR — disclosed definition + estimate flag

`ratios.py:217` guesses `principal = total_debt/5` and uses OCF. Keep a cash-based DSCR but (a) use the banking numerator when PAT is available, (b) flag when principal is estimated.

**Files:** `tests/test_ratios.py`, modify `ratios.py:216-220`

**Step 1: Failing test**
```python
def test_dscr_flags_estimated_principal(tatasteel_financials):
    r = calculate_ratios(tatasteel_financials)
    assert "dscr" in r
    assert r.get("dscr_estimated") is True   # no CPLTD in data → estimated
```

**Step 2:** FAIL.

**Step 3:** Replace the DSCR block:
```python
    # DSCR — prefer (PAT + Dep + Interest) / (Interest + Principal); disclose estimates
    principal = cpltd
    estimated = False
    if principal <= 0 and total_debt > 0:
        principal = total_debt / 5.0   # fallback: assume 5-yr amortisation
        estimated = True
    debt_service = interest + principal
    numerator = (pat + depreciation + interest) if pat > 0 else ocf  # cash accrual basis
    if debt_service > 0 and numerator:
        ratios["dscr"] = round(_div(numerator, debt_service), 2)
        ratios["dscr_estimated"] = estimated
        ratios["dscr_basis"] = "PAT+Dep+Int" if pat > 0 else "OCF"
```

**Step 4:** PASS. **Step 5:** Commit `fix: DSCR discloses basis and flags estimated principal`.

### Task 7: Expose computed FCF ratio

Add `ratios["free_cash_flow"] = free_cash_flow(ocf, capex)` (Task 3 helper) so the memo uses the corrected figure, not the scrape. Test asserts it equals OCF−capex. Commit.

---

## Phase 3 — Validation gate (kills over-confidence)

### Task 8: `validators.py` — data-quality report

**Files:** `tests/test_validators.py`, create `python-service/validators.py`

**Step 1: Failing test**
```python
# tests/test_validators.py
from validators import data_quality_report

def test_missing_pat_caps_confidence():
    fin = {"profit_loss": {"pat": "Dividend Yield"}, "balance_sheet": {}}
    rep = data_quality_report(fin, ratios={})
    assert rep["max_confidence"] in ("LOW", "MEDIUM")
    assert any(i["field"] == "pat" for i in rep["issues"])

def test_balance_sheet_must_balance():
    fin = {"balance_sheet": {"total_assets":[100],"total_equity":[40],
            "borrowings":[30],"other_liabilities":[10]}}  # 40+30+10=80 ≠ 100
    rep = data_quality_report(fin, ratios={})
    assert any("balance" in i["message"].lower() for i in rep["issues"])
```

**Step 2:** FAIL.

**Step 3:** Implement `validators.py`:
```python
"""Deterministic data-quality gate for credit memos. No LLM."""
from finance_utils import as_number

CRITICAL = ("pat", "revenue", "net_worth")

def data_quality_report(financials: dict, ratios: dict) -> dict:
    issues = []
    pl = financials.get("profit_loss", {}) or {}
    bs = financials.get("balance_sheet", {}) or {}

    # PAT present & numeric
    pat = pl.get("pat")
    pat_ok = isinstance(pat, list) and pat and as_number(pat[-1]) is not None
    if not pat_ok:
        issues.append({"field": "pat", "severity": "critical",
                       "message": "PAT missing or non-numeric — profitability/ROE unreliable."})

    # Balance sheet identity A = L + E (5% tolerance)
    ta = _last(bs.get("total_assets")); eq = _last(bs.get("total_equity"))
    debt = _last(bs.get("borrowings")); oth = _last(bs.get("other_liabilities"))
    if ta and eq is not None:
        rhs = (eq or 0) + (debt or 0) + (oth or 0)
        if rhs and abs(rhs - ta) / ta > 0.05:
            issues.append({"field": "balance_sheet", "severity": "high",
                           "message": f"Balance sheet does not balance: A={ta:.0f} vs L+E={rhs:.0f}."})

    # Working-capital inputs
    for fld, label in (("inventories", "inventory"), ("trade_receivables", "receivables")):
        # presence check left light; flag if both day-ratios absent
        pass

    sev = {i["severity"] for i in issues}
    max_conf = "LOW" if "critical" in sev else ("MEDIUM" if "high" in sev else "HIGH")
    return {"passed": not issues, "issues": issues, "max_confidence": max_conf}

def _last(x):
    if isinstance(x, list) and x:
        return as_number(x[-1])
    return as_number(x)
```

**Step 4:** PASS. **Step 5:** Commit `feat: add deterministic data-quality validation gate`.

### Task 9: Wire the gate into memo generation

**Files:** modify `main.py` (`/public-data/generate-memo`, `/generate-memo`), `memo.py`

**Steps:**
1. In each memo endpoint, call `report = data_quality_report(financials, ratios)` before generation.
2. Pass `report` into `generate_cam_memo(...)`.
3. In `memo.py`, **clamp** the LLM's Confidence to `report["max_confidence"]` (never exceed it) and append a **"Data Quality & Limitations"** block listing `report["issues"]`.
4. Return `data_quality` in the JSON response so the UI can show it.
5. Test: regenerated Tata Steel memo asserts confidence ≤ HIGH only if PAT present; otherwise capped. Commit `feat: clamp memo confidence to data-quality gate + limitations section`.

---

## Phase 4 — Tabulated CAM note

### Task 10: `cam_tables.py` — deterministic markdown tables

**Files:** `tests/test_cam_tables.py`, create `python-service/cam_tables.py`

**Step 1: Failing test**
```python
# tests/test_cam_tables.py
from cam_tables import financial_spread, ratio_covenant_table

def test_spread_has_years_as_columns(tatasteel_financials):
    md = financial_spread(tatasteel_financials)
    assert "| Mar 2024 | Mar 2025 | Mar 2026 |" in md.replace("  ", " ")
    assert "Revenue from Operations" in md
    assert "PAT" in md

def test_ratio_table_marks_breach():
    md = ratio_covenant_table({"tol_tnw": 4.0, "debt_equity": 0.5})
    assert "Breach" in md   # 4.0 > 3.00 covenant
```

**Step 2:** FAIL.

**Step 3:** Implement `cam_tables.py` (pure formatting; ₹ Cr, no decimals on crores):
```python
"""Render deterministic CAM tables as GitHub-flavoured Markdown. No LLM, no I/O."""
COVENANTS = [
    ("tol_tnw", "TOL/TNW", "<=", 3.00, "x"),
    ("debt_equity", "Debt/Equity", "<=", 2.00, "x"),
    ("dscr", "DSCR", ">=", 1.25, "x"),
    ("interest_coverage_ratio", "Interest Coverage", ">=", 2.00, "x"),
    ("current_ratio", "Current Ratio", ">=", 1.33, "x"),
]

def _cr(v):
    try: return f"{float(v):,.0f}"
    except (TypeError, ValueError): return "—"

def financial_spread(fin: dict) -> str:
    pl = fin.get("profit_loss", {}); bs = fin.get("balance_sheet", {})
    years = pl.get("years") or bs.get("years") or []
    rows = [
        ("Revenue from Operations", pl.get("revenue")),
        ("EBITDA", pl.get("ebitda")),
        ("PBT", pl.get("pbt")),
        ("PAT", pl.get("pat")),
        ("Net Worth (TNW)", bs.get("total_equity")),
        ("Total Debt", bs.get("borrowings")),
    ]
    head = "| Particulars (₹ Cr) | " + " | ".join(years) + " |"
    sep  = "|" + "---|" * (len(years) + 1)
    body = []
    for label, arr in rows:
        cells = [_cr(x) for x in (arr or [None]*len(years))][:len(years)]
        cells += ["—"] * (len(years) - len(cells))
        body.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join([head, sep, *body])

def ratio_covenant_table(ratios: dict) -> str:
    head = "| Ratio | Actual | Covenant | Status |"
    sep  = "|---|---|---|---|"
    rows = []
    for key, label, op, thr, unit in COVENANTS:
        v = ratios.get(key)
        if v is None: continue
        ok = (v <= thr) if op == "<=" else (v >= thr)
        flag = " (est.)" if key == "dscr" and ratios.get("dscr_estimated") else ""
        rows.append(f"| {label} | {v:.2f}{unit}{flag} | {op} {thr:.2f}{unit} | "
                    f"{'✓ Within' if ok else '✗ Breach'} |")
    return "\n".join([head, sep, *rows]) if rows else ""
```

**Step 4:** PASS. **Step 5:** Commit `feat: deterministic CMA spread + ratio-covenant markdown tables`.

### Task 11: Inject tables into the memo (Python, not LLM)

**Files:** modify `memo.py` (assembly of the Financial Analysis section)

**Steps:** After the LLM returns narrative, insert `financial_spread(financials)` and `ratio_covenant_table(ratios)` markdown immediately under the "Financial Analysis" heading (string insertion, deterministic). Add a header block table (Borrower / Basis: Standalone|Consolidated / Facility / Amount / Date). Test: memo contains `| Particulars (₹ Cr) |`. Commit `feat: embed financial spread + ratio tables into CAM memo`.

### Task 12: Formatting & provenance

**Files:** `memo.py`, `cam_sections.py`
- Single ₹-Cr formatter (whole numbers); remove `.00 Cr` patterns.
- Add a **Basis** line (Standalone vs Consolidated) sourced from `company_info`.
- Add a one-line source note per table (e.g., "Source: Screener.in / company filings; figures to be verified against audited statements.").
- Test: `assert ".00 Cr" not in memo`. Commit.

### Task 13: Frontend — render tables & fix UI defects

**Files:** `frontend/artifacts/creditguard/src/pages/cases/[id]/index.tsx`, `dashboard.tsx`, `DataRoomTab.tsx`, the Drawing-Power component
- Confirm `react-markdown` + `remark-gfm` render GFM tables in the memo view (already in deps); add `prose` table styles if needed.
- Drawing-Power calculator: fix unit label (₹ Cr vs rupee field) and **hide it when `facility_type === "Term Loan"`** (DP is for CC/WC).
- Dashboard: fix `View case → /cases/undefined` (use real `case_id` in the activity payload).
- Remove/ælabel the unverifiable "37.2h time saved" metric or back it with a real computed figure.
- Manual verify via Playwright on `http://localhost:5173`. Commit `fix: render CAM tables; correct DP units/visibility; fix dashboard links`.

---

## Phase 5 — End-to-end verification

### Task 14: Regression on the live Tata Steel case
**Steps:**
1. `./dev.sh` up.
2. `curl -s -XPOST localhost:8000/public-data/generate-memo -d '{"symbol":"TATASTEEL","company_name":"Tata Steel Ltd","industry":"Steel"}' -H 'Content-Type: application/json' -o /tmp/after.json`
3. Assert via a script: `pat` numeric (~16,075), `tol_tnw==1.01`, `free_cash_flow≈6,298`, memo contains `| Particulars (₹ Cr) |` and a ratio table, `data_quality.max_confidence` respected.
4. Screenshot the rendered note. Write a short before/after to `docs/plans/2026-05-31-results.md`.
5. Commit `test: end-to-end credit-integrity regression on Tata Steel`.

---

## Acceptance criteria (definition of done)
- [ ] PAT is a numeric 3-year series for a clean listed company; derived-and-flagged when scrape fails.
- [ ] TOL/TNW = 1.01 on the Tata Steel fixture (formula excludes net worth).
- [ ] DSCR carries `dscr_basis` and `dscr_estimated`; memo discloses estimate.
- [ ] FCF = OCF − capex (≈6,298, not 31,966).
- [ ] Validation gate caps confidence and emits a "Data Quality & Limitations" section.
- [ ] Memo renders a CMA spread table (years as columns) and a ratio-vs-covenant table, on screen and in PDF.
- [ ] No `.00 Cr`; Basis (Standalone/Consolidated) stated; source note present.
- [ ] DP calculator correct units; hidden for Term Loans; dashboard links resolve.
- [ ] `venv/bin/python -m pytest` green.
