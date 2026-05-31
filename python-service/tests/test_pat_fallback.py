from finance_utils import derive_pat


def test_pat_from_eps_and_shares():
    # EPS 12.87, equity capital 1249 (FV Rs 1) -> ~16,075 Cr
    assert round(derive_pat(eps=12.87, share_capital_cr=1249, face_value=1)) == 16075


def test_pat_from_pbt_when_no_eps():
    # PBT 21353, effective tax 25% -> 16,015 Cr
    assert round(derive_pat(pbt=21353, effective_tax=0.25)) == 16015


def test_returns_none_when_nothing_usable():
    assert derive_pat() is None
