"""Pure helpers for deriving / sanitising credit figures. No I/O, no LLM."""
import re as _re
from typing import Optional


def as_number(v) -> Optional[float]:
    """Return a float if `v` is a number or a clean numeric string, else None.

    Guards numeric fields against scrape garbage (regex strings, stray punctuation).
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if _re.fullmatch(r"-?\d+(\.\d+)?", s):
            return float(s)
    return None


def derive_pat(eps: Optional[float] = None, share_capital_cr: Optional[float] = None,
               face_value: float = 1.0, pbt: Optional[float] = None,
               effective_tax: float = 0.25) -> Optional[float]:
    """Best-effort Profit After Tax (Rs Cr) when the scrape is missing it.

    Prefers EPS x shares (shares = equity capital / face value); else PBT x (1 - tax).
    Returns None if neither path has usable inputs.
    """
    if eps and share_capital_cr and face_value:
        shares_cr = share_capital_cr / face_value      # crore shares (FV-adjusted)
        return eps * shares_cr                          # Rs Cr
    if pbt:
        return pbt * (1 - effective_tax)
    return None


def free_cash_flow(ocf: float, capex: float) -> float:
    """FCF = Operating Cash Flow - Capex (capex given as a positive magnitude)."""
    return round(ocf - abs(capex))


# ── Debt service (single basis for every DSCR in the CAM) ─────────────────────
# Screener gives total borrowings only — no repayment schedule and no term/WC
# split — so existing debt is assumed to amortise evenly over this many years.
# Conservative (WC limits normally roll over); the CAM states the assumption.
EXISTING_DEBT_AMORT_YEARS = 5
TL_TENOR_YEARS = 5   # indicative tenor for the proposed term loan


def proposed_term_principal(financials: dict) -> tuple:
    """(proposed term-loan amount ₹ Cr, annual principal ₹ Cr). WC/LC/BG limits
    are non-amortising, so they carry no scheduled principal."""
    fac = (financials or {}).get("facility") or {}
    amt_cr = (as_number(fac.get("amount_inr")) or 0.0) / 1e7
    if fac.get("type") not in ("term_loan", None, ""):
        return 0.0, 0.0
    return amt_cr, (round(amt_cr / TL_TENOR_YEARS, 2) if amt_cr else 0.0)


def dscr(pat, dep, interest, existing_debt, proposed_principal) -> Optional[float]:
    """Banking DSCR = (PAT + Dep + Interest) / (Interest + principal due), where
    principal due = existing borrowings / EXISTING_DEBT_AMORT_YEARS + the
    proposed term loan's annual principal."""
    pat, dep, interest = as_number(pat), as_number(dep) or 0.0, as_number(interest) or 0.0
    if pat is None:
        return None
    principal = (as_number(existing_debt) or 0.0) / EXISTING_DEBT_AMORT_YEARS + (proposed_principal or 0.0)
    service = interest + principal
    return round((pat + dep + interest) / service, 2) if service > 0 else None
