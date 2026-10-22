"""Free LLM fallbacks behind Gemini: NVIDIA NIM, OpenRouter free models, Groq.

All three speak the OpenAI chat-completions API, so one caller handles them.
`fallback(prompt)` walks the chain until a model returns text; providers without
a key are skipped, and a model that rate-limits is benched briefly so parallel
CAM batches don't all queue behind it.

Configuration (env):
  LLM_FALLBACKS          order, default "nvidia,openrouter,groq"
  NVIDIA_API_KEY         free key from build.nvidia.com (nvapi-...)
  NVIDIA_MODELS          comma list, default below
  OPENROUTER_API_KEY     a free-tier key works with ":free" models
  OPENROUTER_FREE_MODELS comma list, default below
  GROQ_API_KEY / GROQ_MODELS
  GEMINI_MODELS          comma list for the primary provider, tried in order
"""
import logging
import os
import re
import threading
import time
from typing import Dict, List

import httpx

logger = logging.getLogger(__name__)

# Pinned GA models first: the "-latest" aliases share one capacity pool and all
# returned 503 "high demand" / 504 together on 2026-10-22 while gemini-2.5-flash
# and gemini-3.5-flash answered in ~2s on the same key.
GEMINI_MODELS = [m.strip() for m in os.getenv(
    "GEMINI_MODELS",
    "models/gemini-2.5-flash,models/gemini-3.5-flash,models/gemini-flash-latest,models/gemini-flash-lite-latest",
).split(",") if m.strip()]


def gemini_text(prompt: str, timeout_ms: int, label: str = "Gemini") -> str:
    """First non-empty reply from GEMINI_MODELS, or "" if every model fails."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ""
    from google import genai
    for model in GEMINI_MODELS:
        try:
            client = genai.Client(api_key=api_key, http_options=genai.types.HttpOptions(timeout=timeout_ms))
            text = (client.models.generate_content(model=model, contents=prompt).text or "").strip()
            if text:
                return text
        except Exception as e:
            logger.error(f"[{label}] Gemini error ({model}): {e}")
    return ""

SYSTEM = ("You are a senior credit risk analyst at an Indian commercial bank. Write formal, concise, "
          "banker-grade text. Use ONLY the data provided. Do NOT fabricate figures. When asked for JSON, "
          "return only the JSON.")

PROVIDERS: Dict[str, Dict[str, str]] = {
    "nvidia": {
        "url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "key_env": "NVIDIA_API_KEY",
        "models_env": "NVIDIA_MODELS",
        "default_models": "deepseek-ai/deepseek-v4.1-flash,nvidia/nemotron-3-super-120b-a12b,nvidia/nemotron-3-ultra-550b-a55b",
    },
    "openrouter": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "models_env": "OPENROUTER_FREE_MODELS",
        "default_models": "nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-ultra-550b-a55b:free",
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "key_env": "GROQ_API_KEY",
        "models_env": "GROQ_MODELS",
        "default_models": "llama-3.3-70b-versatile",
    },
}

BENCH_SECONDS = 60
# A healthy 3-section batch returns in ~30-70s; a stalled call should hand over
# to the next model quickly rather than hold the whole CAM.
TIMEOUT = httpx.Timeout(95.0, connect=10.0)
_benched: Dict[str, float] = {}
_lock = threading.Lock()


def _models(name: str) -> List[str]:
    p = PROVIDERS[name]
    return [m.strip() for m in os.getenv(p["models_env"], p["default_models"]).split(",") if m.strip()]


def configured() -> List[str]:
    """Providers in chain order that have a key."""
    order = [x.strip().lower() for x in os.getenv("LLM_FALLBACKS", "nvidia,openrouter,groq").split(",")]
    return [n for n in order if n in PROVIDERS and os.getenv(PROVIDERS[n]["key_env"])]


def _bench(tag: str) -> None:
    with _lock:
        _benched[tag] = time.monotonic() + BENCH_SECONDS


def _is_benched(tag: str) -> bool:
    with _lock:
        return _benched.get(tag, 0) > time.monotonic()


def _clean(text: str) -> str:
    # Reasoning models may inline their thinking.
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def call(provider: str, model: str, prompt: str, max_tokens: int = 8192) -> str:
    """One model. Returns "" on any failure (and benches it on rate limits)."""
    p = PROVIDERS[provider]
    key = os.getenv(p["key_env"])
    tag = f"{provider}:{model}"
    if not key or _is_benched(tag):
        return ""
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://creditguard-ai.vercel.app"
        headers["X-Title"] = "CreditGuard AI"
    body = {"model": model, "temperature": 0.2, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]}
    try:
        r = httpx.post(p["url"], json=body, headers=headers, timeout=TIMEOUT)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[LLM] {tag} request failed: {e}")
        return ""
    if r.status_code in (402, 404, 410, 429):
        _bench(tag)  # quota / rate limit / model retired or not on this tier
        logger.warning(f"[LLM] {tag} HTTP {r.status_code}; benched {BENCH_SECONDS}s")
        return ""
    if r.status_code >= 400:
        logger.warning(f"[LLM] {tag} HTTP {r.status_code}: {r.text[:200]}")
        return ""
    try:
        return _clean(r.json()["choices"][0]["message"].get("content") or "")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[LLM] {tag} bad response: {e}")
        return ""


def fallback(prompt: str) -> str:
    """Walk the free-provider chain; first non-empty answer wins."""
    for provider in configured():
        for model in _models(provider):
            out = call(provider, model, prompt)
            if out:
                logger.info(f"[LLM] answered by {provider}:{model}")
                return out
    return ""


def status() -> Dict[str, object]:
    """For /health: which providers are armed (never exposes keys)."""
    out: Dict[str, object] = {n: {"configured": bool(os.getenv(PROVIDERS[n]["key_env"])), "models": _models(n)}
                              for n in PROVIDERS}
    out["order"] = configured()
    return out
