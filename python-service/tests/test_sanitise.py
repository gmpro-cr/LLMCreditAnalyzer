from finance_utils import as_number


def test_rejects_regex_and_punctuation():
    assert as_number("Dividend Yield\\s+([\\d.]+)") is None
    assert as_number(")") is None
    assert as_number("") is None
    assert as_number(None) is None


def test_accepts_numbers_and_numeric_strings():
    assert as_number("1,234.5") == 1234.5
    assert as_number(15683.0) == 15683.0
    assert as_number("-42") == -42.0
