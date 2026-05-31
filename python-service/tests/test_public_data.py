import pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / "public_data.py"


def test_pat_loop_var_does_not_shadow_net_profit_array():
    """The regex loop must not reuse `pat` (the Net Profit array) as its loop var.

    Regression lock for the bug where `for pat, key in patterns:` overwrote the
    Net Profit series with the last regex string ('Dividend Yield ...').
    """
    src = SRC.read_text()
    assert "for pat, key in patterns" not in src, (
        "loop variable `pat` shadows the Net Profit array — rename to `pattern`"
    )
