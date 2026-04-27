"""AI-assist: turn a free-text prompt into a structured form payload.

Used by the Next.js forms (Persona, Taxonomy node, LanguageProfile, PromptTemplate)
to auto-fill complex fields. We ask the LLM to return JSON matching the form's
field shape, then parse and forward to the UI.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from . import db
from .crypto import decrypt_secret
from .providers import chat_completion
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
  "name": "Short topic name, 2-80 chars (e.g. 'modem troubleshooting', 'plan upgrade')"
}
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
        """SELECT "baseUrl", "encryptedApiKey", headers, "defaultModel"
           FROM "ProviderCredential" WHERE id = $1""",
        provider_id,
    )
    if not row:
        raise RuntimeError(f"provider not found: {provider_id}")
    return dict(row)


async def ai_assist(
    *,
    kind: str,
    prompt: str,
    provider_id: str,
    model: str | None = None,
    extra_context: str | None = None,
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
        max_tokens=1500,
        extra_headers=extra_headers or None,
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
