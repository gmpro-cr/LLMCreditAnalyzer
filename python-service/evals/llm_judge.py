"""LLM-as-judge scoring for CAM narrative quality. Calls a real LLM provider — costs
quota, not run by default. Opt in with `pytest -m llm_judge`. Complements (does not
replace) the free rule-based checks in test_golden_memos.py — this catches things
regexes can't: tone, coherence, actionability.
"""
import json
import re

from cam_sections import _llm

RUBRIC = """You are auditing a credit-memo section for quality, not accuracy of figures
(a separate deterministic check already covers figures). Score 1-5 on each dimension:

- coherence: does the prose read as a single coherent argument, not disconnected facts?
- actionability: could a credit officer act on this without asking clarifying questions?
- grounding: does it stick to claims plausibly supported by the given context, avoiding
  vague filler ("the company is well-positioned") in place of specifics?

Return ONLY JSON: {{"coherence": <1-5>, "actionability": <1-5>, "grounding": <1-5>,
"notes": "<one sentence>"}}

SECTION TEXT:
{content}"""


def judge_section(content: str) -> dict:
    prompt = RUBRIC.format(content=content[:3000])
    raw = _llm(prompt) or ""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return {"coherence": 0, "actionability": 0, "grounding": 0,
                "notes": "judge returned unparseable output", "raw": raw}
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return {"coherence": 0, "actionability": 0, "grounding": 0,
                "notes": "judge returned invalid JSON", "raw": raw}
