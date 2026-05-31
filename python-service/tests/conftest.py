import json
import pathlib
import sys

import pytest

# Make the python-service modules importable from within tests/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

FIX = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def tatasteel_financials():
    """Screener-format financials captured from a live Tata Steel run.

    Contains the original PAT-corruption bug, so tests can prove fixes.
    """
    return json.loads((FIX / "tatasteel_screener.json").read_text())
