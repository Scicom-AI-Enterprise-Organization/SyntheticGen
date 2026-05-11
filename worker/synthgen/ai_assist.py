"""AI-assist: turn a free-text prompt into a structured form payload.

Used by the Next.js forms (Persona, Taxonomy node, LanguageProfile, PromptTemplate)
to auto-fill complex fields. We ask the LLM to return JSON matching the form's
field shape, then parse and forward to the UI.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, AsyncIterator

from . import db
from .crypto import decrypt_secret
from .providers import chat_completion, chat_completion_stream
from .presets import MANGLISH_PARTICLES, FORMAL_MALAY_SHORTCUTS, TELCO_LOANWORD_ALLOWLIST


log = logging.getLogger(__name__)


# Per-kind schema and instructions. Field shapes mirror the Prisma columns and
# the TS form state, so the UI can spread the result directly.

PERSONA_FIELDS = """\
{
  "name": "Short label, 2-80 chars",
  "description": "1-3 sentences",
  "ethnicity": "one of: malay | chinese | indian | iban | kadazan | orang-asli | mixed | other",
  "region": "one of: kl | selangor | penang | johor | kelantan | terengganu | kedah | perak | melaka | negeri-sembilan | pahang | perlis | sabah | sarawak | putrajaya | labuan",
  "urbanity": "one of: urban | suburban | kampung",
  "ageRange": "one of: 13-17 | 18-24 | 25-34 | 35-49 | 50-64 | 65+",
  "formality": "one of: baku | colloquial | manglish | mixed",
  "religionAware": true_or_false,
  "dialectTags": ["array of short tags like kelantan, manglish, sabahan"]
}
"""

TAXONOMY_NODE_FIELDS = """\
{
  "names": [
    "Short topic name, 2-80 chars (e.g. 'modem troubleshooting')",
    "Another short topic name (e.g. 'plan upgrade')",
    "..."
  ]
}

Return between 3 and 8 distinct topic noun-phrases that are NEW — none of them
may duplicate (case-insensitively) any name from the "Existing nodes" list in
the user message. Prefer concise lowercase-with-hyphens or short multi-word
phrases. Cover complementary areas to the existing taxonomy, not near-synonyms
of nodes that already exist.
"""

LANGUAGE_PROFILE_FIELDS = f"""\
{{
  "name": "Short profile name, 2-120 chars",
  "primary": "one of: ms | en | zh | ta",
  "secondary": ["zero or more of: ms, en, zh, ta — for code-switching"],
  "script": "one of: latin | jawi | hans | hant | tamil",
  "codeSwitchPolicy": "one of: none | inter-sentential | intra-sentential | rojak",
  "codeSwitchRate": 0.0_to_1.0_or_null,
  "register": "one of: formal | semi-formal | colloquial | mixed",
  "allowParticles": true_or_false,
  "bannedTokens": ["lowercase tokens to ban — for formal MS use {MANGLISH_PARTICLES[:6]}..."],
  "bannedPatterns": ["regex patterns, optional"],
  "requireFormalMalay": true_or_false,
  "englishLoanwordPolicy": "one of: forbid | allowlist | free",
  "loanwordAllowlist": ["English loanwords permitted, e.g. {TELCO_LOANWORD_ALLOWLIST[:5]}"],
  "dialectHints": ["e.g. kelantan, manglish"],
  "notes": "1-2 sentence rationale"
}}
"""

PROMPT_TEMPLATE_FIELDS = """\
{
  "name": "Short template name, 2-120 chars",
  "kind": "one of: system | user-seed | judge | conversation-driver",
  "description": "One line",
  "body": "The template text. May include {{persona.name}}, {{persona.region}}, {{persona.urbanity}}, {{taxonomy.path}}, {{language.primary}}, {{difficulty}}."
}
"""

TOOL_DEF_FIELDS = """\
{
  "name": "snake_case identifier — the function name passed to the model (e.g. 'maybank_account_balance', 'mykad_lookup', 'lhdn_efile_status')",
  "description": "1-2 sentence description of what the function does",
  "parameters": {
    "type": "object",
    "properties": {
      "<arg_name>": {
        "type": "string|number|boolean|integer|array|object",
        "description": "..."
      }
    },
    "required": ["<arg_name>", ...]
  },
  "localePresets": ["short tags like mykad, lhdn, maybank, cimb, tng, duitnow, banking, telco — use one or more when relevant"]
}

`parameters` MUST be a valid JSON Schema object describing the function arguments.
"""

FLOW_GRAPH_FIELDS = """\
A conversation flow as a directed graph. Return ONLY this JSON object:

{
  "nodes": [
    {
      "id": "snake_case_id",
      "type": "start | intent | action | condition | end",
      "data": { ...node-kind-specific... }
    },
    ...
  ],
  "edges": [
    {
      "id": "e1",
      "source": "<node id>",
      "target": "<node id>",
      "label": "optional short label, e.g. tool.success | user_confirms"
    },
    ...
  ]
}

Per-node `data` shapes:

  start:     { "label": "Start" }
  intent:    { "label": "Short title", "description": "1 sentence", "examples": ["utterance", ...] }   // 1-4 examples
  action:    { "label": "Short title", "description": "What the assistant does", "toolIds": [...], "toolMode": "sequential | parallel" }
  condition: { "label": "Short title", "expression": "free-text condition" }
  end:       { "label": "Closing label", "outcome": "resolved | escalated | abandoned" }

Constraints (HARD):
- Exactly one node with type=start.
- Every edge.source and edge.target MUST reference an existing node.id.
- For action.toolIds, ONLY use tool IDs from AVAILABLE_TOOLS in the user message. If no
  relevant tool is available, leave toolIds empty (the assistant will respond in plain text).
- Use short snake_case node IDs derived from the label (e.g. "intent_modem_outage",
  "action_lookup_account").
- DO NOT include node positions; the UI auto-layouts.
- DO NOT wrap the JSON in prose, markdown fences, or comments.

Modeling guidance:
- Branch on condition nodes when downstream behavior depends on tool results or user
  response. Label each outgoing edge with the case (e.g. "tool.success", "tool.not_found",
  "yes", "no").
- Multi-call turns: put multiple tools on a single Action node's toolIds. Use
  toolMode=sequential when later calls depend on earlier results, parallel when independent.
- Every flow must reach at least one end node from start.
- Prefer clarity over completeness — 5-15 nodes is usually right.
"""

KIND_FIELDS: dict[str, str] = {
    "persona": PERSONA_FIELDS,
    "taxonomy-node": TAXONOMY_NODE_FIELDS,
    "language-profile": LANGUAGE_PROFILE_FIELDS,
    "prompt-template": PROMPT_TEMPLATE_FIELDS,
    "tool-def": TOOL_DEF_FIELDS,
    "flow-graph": FLOW_GRAPH_FIELDS,
}


# Per-kind cap on completion tokens. Reasoning models (Qwen3 thinking,
# DeepSeek-R1, etc.) can spend many tokens on chain-of-thought before producing
# the final JSON — keep these generous so the answer doesn't truncate.
DEFAULT_MAX_TOKENS = 4000
KIND_MAX_TOKENS: dict[str, int] = {
    "taxonomy-node": 4000,
    "persona": 6000,
    "prompt-template": 6000,
    "tool-def": 6000,
    "language-profile": 16000,
    "flow-graph": 16000,
}


SYSTEM_TEMPLATE = """\
You are a configuration assistant for SyntheticGen, a Malaysia-focused synthetic
dataset generator. Your job is to translate the user's natural-language description
into a single JSON object that fills a form for: {kind}.

Return ONLY the JSON object — no surrounding text, no markdown fences, no commentary.
The object MUST conform to this field shape (omit a field rather than guess):

{fields}

Defaults / hints:
- For Malaysian enterprise / TM-style scenarios: register=formal, allowParticles=false,
  requireFormalMalay=true, englishLoanwordPolicy=allowlist with telco terms
  (router, modem, bil, bandwidth, internet, wifi).
- For casual Malaysian content (social media, B2C marketing): register=colloquial,
  allowParticles=true, codeSwitchPolicy=intra-sentential, codeSwitchRate=0.3-0.5.
- Banned-token list when allowParticles=false should include the standard Manglish
  particles ({particles}).
- For taxonomy nodes, return only a single concise topic noun phrase in `name`.
"""


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _extract_json(text: str) -> dict[str, Any]:
    """Tolerant JSON parser — strips fences, finds the first {...} blob."""
    cleaned = _FENCE_RE.sub("", text).strip()
    # Fall back to first balanced brace span if the model added prose.
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    if start < 0:
        raise ValueError("model did not return any JSON object")
    depth = 0
    end = -1
    for i, ch in enumerate(cleaned[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        raise ValueError("model returned an unbalanced JSON object")
    return json.loads(cleaned[start:end])


async def _load_provider(provider_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """SELECT "baseUrl", "encryptedApiKey", headers, "defaultModel",
                  "reasoningEffort", "chatTemplateKwargs"
           FROM "ProviderCredential" WHERE id = $1""",
        provider_id,
    )
    if not row:
        raise RuntimeError(f"provider not found: {provider_id}")
    return dict(row)


def _as_dict(v: Any) -> dict[str, Any] | None:
    if isinstance(v, dict):
        return v if v else None
    if isinstance(v, str) and v.strip():
        try:
            parsed = json.loads(v)
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) and parsed else None
    return None


async def ai_assist(
    *,
    kind: str,
    prompt: str,
    provider_id: str,
    model: str | None = None,
    extra_context: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Call the LLM and return a parsed dict suitable for spreading into form state."""
    fields = KIND_FIELDS.get(kind)
    if fields is None:
        raise ValueError(
            f"unknown ai-assist kind '{kind}' (expected: {', '.join(KIND_FIELDS)})"
        )

    provider = await _load_provider(provider_id)
    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = provider.get("headers")
    if isinstance(extra_headers, str):
        extra_headers = json.loads(extra_headers)
    selected_model = model or provider.get("defaultModel") or "gpt-4o-mini"

    system_text = SYSTEM_TEMPLATE.format(
        kind=kind,
        fields=fields,
        particles=", ".join(MANGLISH_PARTICLES),
    )

    user_text = prompt
    if extra_context:
        user_text = f"{prompt}\n\nAdditional context:\n{extra_context}"

    result = await chat_completion(
        base_url=base_url,
        api_key=api_key,
        model=selected_model,
        messages=[
            {"role": "system", "content": system_text},
            {"role": "user", "content": user_text},
        ],
        temperature=0.3,
        max_tokens=max_tokens if max_tokens and max_tokens > 0 else KIND_MAX_TOKENS.get(kind, DEFAULT_MAX_TOKENS),
        extra_headers=extra_headers or None,
        reasoning_effort=provider.get("reasoningEffort"),
        chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")),
    )

    parsed = _extract_json(result.content)
    return {
        "data": parsed,
        "model": result.model,
        "tokens_in": result.tokens_in,
        "tokens_out": result.tokens_out,
        "cost_usd": result.cost_usd,
        "latency_ms": result.latency_ms,
    }


RANDOM_PROMPT_SYSTEM = """\
You generate concise prompts that will be fed into an AI form-filling dialog.
Output ONLY the prompt text — no surrounding quotes, no markdown fences, no
preamble, no commentary, no "Here is..." prefix. One or two sentences max.
Be specific and creative.
"""


def _strip_wrapping(text: str) -> str:
    t = text.strip()
    # Drop leading/trailing markdown fences if any.
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
        t = t.strip()
    # Drop a single layer of surrounding quotes.
    if len(t) >= 2 and t[0] in ('"', "'", "“", "‘") and t[-1] in ('"', "'", "”", "’"):
        t = t[1:-1].strip()
    return t


async def random_prompt_stream(
    *,
    provider_id: str,
    description: str,
    extra_context: str | None = None,
    max_tokens: int = 4000,
) -> AsyncIterator[dict[str, Any]]:
    """Streaming version of random_prompt: yields delta events as the LLM types
    the suggested prompt, then a final {type:"done", text:...}.

    Same event vocabulary as ai_assist_stream so the client can reuse parsing.
    """
    try:
        provider = await _load_provider(provider_id)
    except Exception as e:
        yield {"type": "error", "error": str(e)}
        return

    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = provider.get("headers")
    if isinstance(extra_headers, str):
        extra_headers = json.loads(extra_headers)
    selected_model = provider.get("defaultModel") or "gpt-4o-mini"

    user_text = description
    if extra_context:
        user_text = f"{description}\n\n{extra_context}"

    yield {"type": "start", "model": selected_model}

    started = time.perf_counter()
    content: list[str] = []
    tokens_in = 0
    tokens_out = 0
    upstream_model = selected_model
    try:
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=selected_model,
            messages=[
                {"role": "system", "content": RANDOM_PROMPT_SYSTEM},
                {"role": "user", "content": user_text},
            ],
            temperature=1.0,
            max_tokens=max_tokens,
            extra_headers=extra_headers or None,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")),
        ):
            if ev.done:
                tokens_in = ev.tokens_in
                tokens_out = ev.tokens_out
                upstream_model = ev.model or selected_model
                break
            if ev.delta:
                if not ev.reasoning:
                    content.append(ev.delta)
                yield {"type": "delta", "text": ev.delta, "reasoning": ev.reasoning}
    except Exception as e:
        yield {"type": "error", "error": str(e)}
        return

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    text = _strip_wrapping("".join(content))
    if not text:
        yield {
            "type": "error",
            "error": "Model produced no content. If using a reasoning model, "
                     "set chat_template_kwargs.enable_thinking=false on the provider "
                     "or raise the max-tokens slider.",
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
        }
        return

    yield {
        "type": "done",
        "text": text,
        "model": upstream_model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": elapsed_ms,
    }


async def random_prompt(
    *,
    provider_id: str,
    description: str,
    extra_context: str | None = None,
    max_tokens: int = 4000,
) -> dict[str, Any]:
    """Ask the LLM for a single-shot one-sentence prompt and return it as text.

    Used by the "Randomize" button in the AI-fill dialogs. Uses the same provider
    settings (reasoning_effort, chat_template_kwargs) as the regular ai_assist
    path — so if the user configured `enable_thinking: false` on the provider,
    randomize stays snappy.
    """
    provider = await _load_provider(provider_id)
    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = provider.get("headers")
    if isinstance(extra_headers, str):
        extra_headers = json.loads(extra_headers)
    selected_model = provider.get("defaultModel") or "gpt-4o-mini"

    user_text = description
    if extra_context:
        user_text = f"{description}\n\n{extra_context}"

    result = await chat_completion(
        base_url=base_url,
        api_key=api_key,
        model=selected_model,
        messages=[
            {"role": "system", "content": RANDOM_PROMPT_SYSTEM},
            {"role": "user", "content": user_text},
        ],
        temperature=1.0,
        max_tokens=max_tokens,
        extra_headers=extra_headers or None,
        reasoning_effort=provider.get("reasoningEffort"),
        chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")),
    )
    text = _strip_wrapping(result.content)
    return {
        "text": text,
        "model": result.model,
        "tokens_in": result.tokens_in,
        "tokens_out": result.tokens_out,
        "latency_ms": result.latency_ms,
    }


async def ai_assist_stream(
    *,
    kind: str,
    prompt: str,
    provider_id: str,
    model: str | None = None,
    extra_context: str | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Like `ai_assist`, but yields incremental events:
      {"type":"delta","text":"..."} during generation,
      {"type":"done","data":{...},"model":"...","tokens_in":..,"tokens_out":..,
       "latency_ms":..} once the full response has been parsed,
      {"type":"error","error":"..."} on failure.
    """
    fields = KIND_FIELDS.get(kind)
    if fields is None:
        yield {
            "type": "error",
            "error": f"unknown ai-assist kind '{kind}' (expected: {', '.join(KIND_FIELDS)})",
        }
        return

    try:
        provider = await _load_provider(provider_id)
    except Exception as e:
        yield {"type": "error", "error": str(e)}
        return

    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = provider.get("headers")
    if isinstance(extra_headers, str):
        extra_headers = json.loads(extra_headers)
    selected_model = model or provider.get("defaultModel") or "gpt-4o-mini"

    system_text = SYSTEM_TEMPLATE.format(
        kind=kind,
        fields=fields,
        particles=", ".join(MANGLISH_PARTICLES),
    )
    user_text = prompt
    if extra_context:
        user_text = f"{prompt}\n\nAdditional context:\n{extra_context}"

    yield {"type": "start", "model": selected_model}

    started = time.perf_counter()
    full_text = ""
    tokens_in = 0
    tokens_out = 0
    upstream_model = selected_model
    try:
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=selected_model,
            messages=[
                {"role": "system", "content": system_text},
                {"role": "user", "content": user_text},
            ],
            temperature=0.3,
            max_tokens=max_tokens if max_tokens and max_tokens > 0 else KIND_MAX_TOKENS.get(kind, DEFAULT_MAX_TOKENS),
            extra_headers=extra_headers or None,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")),
        ):
            if ev.done:
                full_text = ev.full_text
                tokens_in = ev.tokens_in
                tokens_out = ev.tokens_out
                upstream_model = ev.model or selected_model
                break
            if ev.delta:
                yield {
                    "type": "delta",
                    "text": ev.delta,
                    "reasoning": ev.reasoning,
                }
    except Exception as e:
        yield {"type": "error", "error": str(e)}
        return

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    try:
        parsed = _extract_json(full_text)
    except Exception as e:
        yield {
            "type": "error",
            "error": f"failed to parse JSON from model output: {e}",
            "raw": full_text[-2000:],
        }
        return

    yield {
        "type": "done",
        "data": parsed,
        "model": upstream_model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": elapsed_ms,
    }
