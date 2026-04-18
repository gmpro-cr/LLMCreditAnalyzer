"""
Autoresearch agent — genuine Karpathy-style iterative loop.

Pattern (from Karpathy's "Deep Research" concept):
  1. Bootstrap: 3 broad initial queries about the company
  2. LLM reflects on what it found, identifies knowledge gaps,
     and GENERATES the next targeted search queries
  3. Execute those queries, add findings to context
  4. Repeat for MAX_ROUNDS
  5. Final synthesis into structured Research Brief

The LLM drives the search — not pre-defined templates.
"""
import os
import re
import logging
import httpx
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_ROUNDS          = 4      # default reflection rounds (adaptive: 3-5)
MIN_ROUNDS          = 2      # always do at least this many
RESULTS_PER_QUERY   = 3      # DDG results per query
QUERIES_PER_ROUND   = 3      # queries the LLM generates per round
FULL_PAGES_PER_ROUND= 2      # pages to fetch per round
PAGE_MAX_CHARS      = 2500
SCORE_EARLY_STOP    = 85     # stop if avg completeness >= this %
SCORE_EXTEND_THRESH = 50     # extend rounds if avg completeness < this %
MAX_EXTENDED_ROUNDS = 5      # max rounds when extending
SKIP_DOMAINS        = {"twitter.com", "x.com", "facebook.com", "instagram.com",
                       "youtube.com", "linkedin.com", "reddit.com"}


# ── Low-level web helpers ──────────────────────────────────────────────────────

def _ddg_search(query: str, max_results: int = RESULTS_PER_QUERY) -> List[dict]:
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return [
            {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")}
            for r in results
        ]
    except Exception as e:
        logger.warning(f"DDG search failed for '{query}': {e}")
        return []


def _fetch_page(url: str, max_chars: int = PAGE_MAX_CHARS) -> str:
    if any(d in url for d in SKIP_DOMAINS) or url.endswith(".pdf"):
        return ""
    try:
        resp = httpx.get(url, timeout=8.0, follow_redirects=True,
                         headers={"User-Agent": "Mozilla/5.0 (compatible; CreditResearchBot/1.0)"})
        resp.raise_for_status()
        text = re.sub(r"<style[^>]*>.*?</style>", " ", resp.text, flags=re.DOTALL)
        text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars]
    except Exception:
        return ""


# ── LLM call (Ollama, with optional Gemini fallback) ──────────────────────────

def _llm_call(prompt: str) -> Optional[str]:
    """
    Call the configured LLM.
    Controlled by RESEARCHER_PROVIDER env var ("groq" | "gemini" | "ollama"), default "groq".
    """
    provider = os.getenv("RESEARCHER_PROVIDER", "openrouter").lower()

    if provider == "openrouter":
        result = _openrouter_call(prompt)
        if result:
            return result
        logger.warning("[Research] OpenRouter failed, trying Groq fallback")
        return _groq_call(prompt)

    if provider == "groq":
        result = _groq_call(prompt)
        if result:
            return result
        logger.warning("[Research] Groq failed, trying Gemini fallback")
        return _gemini_call(prompt)

    if provider == "gemini":
        result = _gemini_call(prompt)
        if result:
            return result
        logger.warning("[Research] Gemini failed, trying Groq fallback")
        return _groq_call(prompt)

    result = _ollama_call(prompt)
    if result:
        return result
    logger.warning("[Research] Ollama call failed, trying Groq fallback")
    return _groq_call(prompt)


def _openrouter_call(prompt: str) -> Optional[str]:
    try:
        from openai import OpenAI
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            return None
        client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")
        system = (
            "You are a senior credit analyst conducting web research for "
            "a Credit Appraisal Memorandum at an Indian bank. "
            "Be concise, factual, and cite specific details from the research provided."
        )
        chat = client.chat.completions.create(
            model=os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-chat:free"),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2048,
        )
        return chat.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"[Research] OpenRouter call failed: {e}")
        return None


def _groq_call(prompt: str) -> Optional[str]:
    try:
        from groq import Groq
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            return None
        client = Groq(api_key=api_key)
        system = (
            "You are a senior credit analyst conducting web research for "
            "a Credit Appraisal Memorandum at an Indian bank. "
            "Be concise, factual, and cite specific details from the research provided."
        )
        chat = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2048,
        )
        return chat.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"[Research] Groq call failed: {e}")
        return None


def _ollama_call(prompt: str) -> Optional[str]:
    ollama_url   = os.getenv("OLLAMA_URL",   "http://localhost:11434")
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
    try:
        resp = httpx.post(
            f"{ollama_url}/v1/chat/completions",
            json={
                "model": ollama_model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a senior credit analyst conducting web research for "
                            "a Credit Appraisal Memorandum at an Indian bank. "
                            "Be concise, factual, and cite specific details from the research provided."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "stream": False,
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error(f"[Research] Ollama call failed: {e}")
        return None


def _gemini_call(prompt: str) -> Optional[str]:
    try:
        from google import genai
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return None
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="models/gemini-flash-lite-latest",
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        logger.error(f"[Research] Gemini call failed: {e}")
        return None


def _fin_summary(snap: dict) -> str:
    years   = snap.get("years", [])
    revenue = snap.get("revenue", [])
    pat     = snap.get("pat", [])
    debt    = snap.get("debt", [])
    lines   = []
    for i, yr in enumerate(years):
        parts = []
        if i < len(revenue) and revenue[i] is not None: parts.append(f"Revenue ₹{float(revenue[i]):,.0f} Cr")
        if i < len(pat)     and pat[i] is not None:     parts.append(f"PAT ₹{float(pat[i]):,.0f} Cr")
        if i < len(debt)    and debt[i] is not None:    parts.append(f"Debt ₹{float(debt[i]):,.0f} Cr")
        if parts:
            lines.append(f"  {yr}: {', '.join(parts)}")
    return "\n".join(lines) if lines else "Not provided"


# ── Reflection step: LLM identifies gaps and generates next queries ────────────

def _reflect(
    context_so_far: str,
    company_name: str,
    industry: str,
    fin_summary: str,
    round_num: int,
) -> Tuple[str, List[str], Dict[str, int]]:
    """
    Karpathy-style evaluate step: LLM reflects on findings,
    identifies gaps, generates targeted queries, AND self-scores
    its research completeness on 7 credit-relevant dimensions.

    Returns (summary_text, [query1, query2, query3], {dimension: score})
    """
    prompt = f"""You are a senior credit analyst conducting web research for a Credit Risk Summary.

SUBJECT: {company_name} | Industry: {industry} (India)
KNOWN FINANCIALS:
{fin_summary}

RESEARCH GATHERED SO FAR (Round {round_num}):
{context_so_far[:5000]}

---
Your job now:

STEP 1 — Briefly summarise what you have learned (2-3 lines max).

STEP 2 — List the 3 most critical gaps for a credit risk assessment that are still unanswered. Be specific (e.g. "promoter shareholding pledge %" or "whether ICRA rating was downgraded in 2024" or "main raw material cost exposure").

STEP 3 — Generate exactly 3 targeted web search queries to fill those gaps. Each query must be specific and different from queries already run. Write India-focused queries.

STEP 4 — Rate your research completeness (0-100%) on each dimension:

Output ONLY in this format (no extra text):

SUMMARY: <2-3 sentences>

GAPS:
1. <gap>
2. <gap>
3. <gap>

QUERIES:
1. <search query>
2. <search query>
3. <search query>

SCORES:
company_profile: <0-100>
management: <0-100>
financials: <0-100>
industry: <0-100>
competition: <0-100>
credit_signals: <0-100>
risk_factors: <0-100>"""

    response = _llm_call(prompt)
    if not response:
        return "", [], {}

    # Strip thinking traces from qwen3
    response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()

    # Parse queries and scores
    queries = []
    in_queries = False
    in_scores = False
    summary_parts = []
    in_summary = False
    scores = {}
    for line in response.splitlines():
        stripped = line.strip()
        if stripped.startswith("SUMMARY:"):
            in_summary = True
            in_queries = False
            in_scores = False
            summary_parts.append(stripped[len("SUMMARY:"):].strip())
        elif stripped.startswith("GAPS:"):
            in_summary = False
            in_queries = False
            in_scores = False
        elif stripped.startswith("QUERIES:"):
            in_summary = False
            in_queries = True
            in_scores = False
        elif stripped.startswith("SCORES:"):
            in_summary = False
            in_queries = False
            in_scores = True
        elif in_queries and re.match(r"^\d+\.", stripped):
            q = re.sub(r"^\d+\.\s*", "", stripped).strip()
            if q and len(q) > 5:
                queries.append(q)
        elif in_scores and ":" in stripped:
            parts = stripped.split(":", 1)
            key = parts[0].strip()
            try:
                val = int(re.search(r'\d+', parts[1]).group())
                scores[key] = min(100, max(0, val))
            except (AttributeError, ValueError):
                pass
        elif in_summary and stripped:
            summary_parts.append(stripped)

    summary = " ".join(summary_parts).strip()
    avg_score = round(sum(scores.values()) / len(scores)) if scores else 0
    logger.info(
        f"[Research] Round {round_num} reflection → {len(queries)} queries | "
        f"scores: {scores} (avg={avg_score}%)"
    )
    return summary, queries[:QUERIES_PER_ROUND], scores


# ── Final synthesis ────────────────────────────────────────────────────────────

def _synthesize(
    all_context: str,
    company_name: str,
    industry: str,
    fin_snapshot: dict,
) -> str:
    fin_sum = _fin_summary(fin_snapshot)

    prompt = f"""You are a senior credit risk analyst. Using the research below (LLM parametric knowledge + multi-round web research), write a comprehensive Research Brief for a Credit Appraisal Memorandum.

The research includes:
- [LLM WIKI] sections: the model's parametric training knowledge — broad background, use for context
- Web search results: live facts, recent news, current ratings — prioritise these over LLM Wiki when they conflict

Company: {company_name}
Industry: {industry} (India)
3-Year Financial Snapshot:
{fin_sum}

Write exactly these 7 sections. Be SPECIFIC — cite actual facts, names, figures, and dates.
Do NOT fabricate figures. Mark anything from LLM Wiki (not web-confirmed) as "(from LLM knowledge — verify)".
Write "Not found" if nothing relevant was discovered.
Do NOT include any thinking tags or reasoning traces.

## Company Overview
(4-5 sentences: what the company does, core products/services, scale, geography, key customers/segments, incorporation history)

## Promoters & Management
(Promoter names, background, experience, governance quality. CRITICAL: report promoter holding %, any pledging of shares, SEBI actions, court cases, related party concerns)

## Recent Developments (2023–2025)
(Bullet list: order wins, capacity additions, acquisitions, leadership changes, debt restructuring, strategic partnerships, regulatory events)

## Industry Context & Outlook
(Market size, CAGR, India-specific demand drivers, headwinds/tailwinds, commodity sensitivity, regulatory environment)

## Competitive Landscape
(Named competitors, market position, customer concentration, pricing power, barriers to entry)

## Credit & Risk Signals
(CRITICAL for credit risk assessment — report ANY of these found:
- Credit ratings: agency, rating, outlook, any upgrades/downgrades
- Default history, NPA classification, debt restructuring
- Promoter share pledging percentage
- Legal disputes, regulatory penalties
- Contingent liabilities mentioned in filings
- Auditor qualifications or emphasis of matter
- Cheque bounces, overutilization of limits)

## Key External Risk Factors
(5 specific risks, quantified where possible: e.g. "₹X Cr exposure to Y commodity", "Z% revenue from single customer")

---
ALL RESEARCH DATA (multi-round):
{all_context[:8000]}"""

    result = _llm_call(prompt)
    if result:
        return result

    # Fallback: return raw context excerpt if Gemini unavailable
    return all_context[:3000]


# ── LLM Wiki lookup ───────────────────────────────────────────────────────────

def llm_wiki_lookup(company_name: str, sector: str) -> str:
    """
    Karpathy LLM-as-Wikipedia: query the model for its parametric knowledge
    about the company BEFORE any web search. Returns a structured wiki-style
    profile that seeds the research context.

    The LLM already knows well-known Indian listed companies — their business,
    promoters, group structure, sector dynamics, regulatory context — from training
    data. This gives instant, broad base knowledge that the DDG research loop then
    fills with recent/specific facts.
    """
    prompt = f"""You are an encyclopaedia of Indian business and finance.
Write a structured factual wiki profile for the company below, drawing ONLY on your training knowledge.
Mark facts you are uncertain about with "(unverified)". Write "Not known" for gaps.
Do NOT invent specific figures — use ranges or qualitative descriptions if unsure.

COMPANY: {company_name}
SECTOR: {sector}

Write exactly these sections:

## Business Overview
(What the company does: core products/services, revenue streams, scale, geographic footprint,
year of incorporation, listing exchange. 4-5 sentences.)

## Group Structure & Promoters
(Parent group if any, key promoters/founders and their background, promoter holding %
and any known pledging. Key subsidiaries and associates.)

## Management
(MD/CEO name and tenure, key board members, management track record, any governance concerns known.)

## Industry Position
(Market position — leader/challenger/niche. Named key competitors. Customer segments.
Known key clients if any. Entry barriers in this sector.)

## Sector Dynamics — {sector}
(India-specific: market size, growth rate, key demand drivers, regulatory environment,
input cost pressures, government policy tailwinds/headwinds, recent sector events.)

## Known Credit & Risk Signals
(Any known credit ratings — agency and rating. History of defaults, restructuring, NPA.
Promoter pledging. Material legal cases. Major contingent liabilities. Auditor changes.)

## Recent Developments
(Bullet points: major expansions, acquisitions, leadership changes, order wins, funding rounds,
any negative events in 2022-2025 you are aware of.)

Be concise. Each section: 3-5 sentences or bullet points."""

    result = _llm_call(prompt)
    if not result:
        return ""
    # Strip any thinking traces
    result = re.sub(r'<think>.*?</think>', '', result, flags=re.DOTALL).strip()
    logger.info(f"[LLM Wiki] Generated profile for {company_name} ({len(result)} chars)")
    return result


# ── Main entry point ───────────────────────────────────────────────────────────

def run_research(
    company_name: str,
    industry: str = "Manufacturing",
    financials_snapshot: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """
    Karpathy-style autoresearch loop:
      Round 0  — Bootstrap: 3 broad seed queries
      Round 1+ — LLM reflects on findings, identifies gaps, generates targeted queries
      Final    — LLM synthesizes all context into structured Research Brief

    Returns: {brief, sources, queries_run}
    """
    if financials_snapshot is None:
        financials_snapshot = {}

    logger.info(f"[Research] Starting for: {company_name} | {industry}")

    all_snippets:  List[str]  = []
    sources:       List[dict] = []
    queries_run:   List[str]  = []
    fetched_urls:  set        = set()

    # ── helpers ────────────────────────────────────────────────────────────────

    def _run_queries(queries: List[str]) -> List[dict]:
        """Execute queries, accumulate snippets + sources. Returns new sources."""
        new_sources = []
        for q in queries:
            queries_run.append(q)
            logger.info(f"[Research] Query: {q}")
            results = _ddg_search(q)
            for r in results:
                src = {"title": r["title"], "url": r["url"]}
                sources.append(src)
                new_sources.append(src)
                snippet = f"[{r['title']}]\n{r['snippet']}"
                all_snippets.append(snippet)
        return new_sources

    def _fetch_pages(src_list: List[dict], max_pages: int = FULL_PAGES_PER_ROUND) -> None:
        """Fetch full page text for up to max_pages new URLs."""
        fetched = 0
        for src in src_list:
            if fetched >= max_pages:
                break
            url = src.get("url", "")
            if not url or url in fetched_urls:
                continue
            text = _fetch_page(url)
            if len(text) > 300:
                fetched_urls.add(url)
                all_snippets.append(f"FULL PAGE [{src['title']}]:\n{text}")
                fetched += 1

    def _context_so_far() -> str:
        return "\n\n---\n\n".join(all_snippets)

    # ── LLM Wiki: seed with parametric knowledge BEFORE any web search ────────
    # The LLM already knows well-known Indian listed companies from training data.
    # This gives rich base context instantly; the DDG loop fills in recent/specific facts.
    logger.info(f"[Research] LLM Wiki lookup for {company_name}")
    wiki_profile = llm_wiki_lookup(company_name, industry)
    if wiki_profile:
        all_snippets.insert(0, f"[LLM WIKI — PARAMETRIC KNOWLEDGE]\n{wiki_profile}")
        logger.info(f"[Research] LLM Wiki seeded {len(wiki_profile)} chars into context")

    # ── Round 0: Bootstrap DDG search ─────────────────────────────────────────
    # Focus the seed queries on gaps the LLM Wiki won't have: recent news + live data
    seed_queries = [
        f"{company_name} latest news 2024 2025 revenue profit results India",
        f"{company_name} promoters management credit rating ICRA CRISIL 2024 2025",
        f"{company_name} annual report FY2025 FY2024 financial results India",
    ]
    new_sources = _run_queries(seed_queries)
    _fetch_pages(new_sources, max_pages=2)

    if not all_snippets:
        logger.warning(f"[Research] No results for {company_name}")
        return {"brief": "", "sources": [], "queries_run": queries_run}

    # ── Rounds 1…N: Karpathy-style LLM-driven iterative deepening ──────────────
    fin_sum = _fin_summary(financials_snapshot)
    round_summaries: List[str] = []
    all_scores: List[Dict[str, int]] = []
    effective_max_rounds = MAX_ROUNDS

    for round_num in range(1, MAX_EXTENDED_ROUNDS + 1):
        if round_num > effective_max_rounds:
            break

        logger.info(f"[Research] Reflection round {round_num}/{effective_max_rounds}")

        summary, next_queries, scores = _reflect(
            context_so_far=_context_so_far(),
            company_name=company_name,
            industry=industry,
            fin_summary=fin_sum,
            round_num=round_num,
        )

        if summary:
            round_summaries.append(f"Round {round_num}: {summary}")

        if scores:
            all_scores.append(scores)
            avg_score = round(sum(scores.values()) / len(scores)) if scores else 0

            # Karpathy-style adaptive: evaluate and keep/extend
            if avg_score >= SCORE_EARLY_STOP and round_num >= MIN_ROUNDS:
                logger.info(
                    f"[Research] Self-score {avg_score}% >= {SCORE_EARLY_STOP}% — "
                    f"stopping early (sufficient research quality)"
                )
                break

            if avg_score < SCORE_EXTEND_THRESH and round_num == MAX_ROUNDS:
                effective_max_rounds = MAX_EXTENDED_ROUNDS
                logger.info(
                    f"[Research] Self-score {avg_score}% < {SCORE_EXTEND_THRESH}% — "
                    f"extending to {MAX_EXTENDED_ROUNDS} rounds"
                )

        if not next_queries:
            logger.info(f"[Research] LLM produced no new queries — stopping early")
            break

        new_sources = _run_queries(next_queries)
        _fetch_pages(new_sources, max_pages=FULL_PAGES_PER_ROUND)

    # ── Final synthesis ────────────────────────────────────────────────────────
    logger.info(f"[Research] Synthesizing — {len(all_snippets)} snippets, {len(sources)} sources")
    brief = _synthesize(_context_so_far(), company_name, industry, financials_snapshot)

    logger.info(f"[Research] Done — brief {len(brief)} chars, {len(sources)} sources, {len(queries_run)} queries")

    # Compute final research completeness score
    final_score = 0
    if all_scores:
        last_scores = all_scores[-1]
        final_score = round(sum(last_scores.values()) / len(last_scores)) if last_scores else 0

    return {
        "brief":        brief,
        "sources":      sources[:20],
        "queries_run":  queries_run,
        "round_summaries": round_summaries,
        "research_completeness_score": final_score,
        "dimension_scores": all_scores[-1] if all_scores else {},
    }
