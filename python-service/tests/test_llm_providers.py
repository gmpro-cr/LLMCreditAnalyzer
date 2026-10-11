"""Free-provider fallback chain (no network: httpx.post is stubbed)."""
import httpx
import pytest

import llm_providers as lp


class _Resp:
    def __init__(self, code, content=""):
        self.status_code, self._content, self.text = code, content, content

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    lp._benched.clear()
    for k in ("NVIDIA_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "LLM_FALLBACKS"):
        monkeypatch.delenv(k, raising=False)


def test_keyless_providers_are_skipped(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    assert lp.configured() == ["openrouter"]
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(200, "ok from openrouter"))
    assert lp.fallback("hi") == "ok from openrouter"


def test_chain_moves_on_and_benches_rate_limited_model(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "n")
    monkeypatch.setenv("OPENROUTER_API_KEY", "o")
    calls = []

    def post(url, json, headers, timeout):
        calls.append(json["model"])
        return _Resp(429) if "nvidia.com" in url else _Resp(200, "<think>x</think>answer")
    monkeypatch.setattr(httpx, "post", post)
    assert lp.fallback("hi") == "answer"           # reasoning block stripped
    first = len(calls)
    lp.fallback("again")                            # NVIDIA models are benched now
    assert all("nvidia" not in m or m.endswith(":free") for m in calls[first:])


def test_all_fail_returns_empty(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(500, "boom"))
    assert lp.fallback("hi") == ""


def test_gemini_failure_routes_to_fallback(monkeypatch):
    import cam_sections
    monkeypatch.setenv("MEMO_PROVIDER", "gemini")
    monkeypatch.setattr(cam_sections, "_gemini_call", lambda p: "")
    monkeypatch.setattr(lp, "fallback", lambda p: "from fallback")
    assert cam_sections._llm("x") == "from fallback"
