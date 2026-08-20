import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

FIX = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def healthy_co():
    return json.loads((FIX / "healthy_co.json").read_text())


@pytest.fixture
def distressed_co():
    return json.loads((FIX / "distressed_co.json").read_text())
