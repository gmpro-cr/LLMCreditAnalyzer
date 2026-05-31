"""Pure helpers for deriving / sanitising credit figures. No I/O, no LLM."""
from typing import Optional


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
