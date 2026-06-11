"""Single-turn generation pipeline.

Slice 1: one LLM call per job, single-turn conversation, no tool calls.
Architecture allows multi-turn / tool-calls to slot in later without schema changes.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import asdict
from typing import Any

from . import db
from .crypto import decrypt_secret
from .flow_runner import execute_flow_job
from .ids import cuid_like
from .providers import chat_completion, chat_completion_stream, estimate_cost
from .style_guide import FormalityPolicy, style_guide
from .templates import RenderContext, render
from .validators import ValidatorContext, run_pipeline


log = logging.getLogger(__name__)


def _as_dict(v: Any) -> dict[str, Any]:
    """Coerce a JSONB column value (which asyncpg returns as str) to a dict."""
    if v is None:
        return {}
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        return json.loads(v)
    return dict(v)


async def _load_run(run_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """
        SELECT id, "projectId", model, "samplingParams", "configSnapshot",
               "providerCredentialId", "templateId", "languageProfileId",
               "formalityPolicy", status
        FROM "GenerationRun" WHERE id = $1
        """,
        run_id,
    )
    if not row:
        raise RuntimeError(f"run not found: {run_id}")
    return dict(row)


async def _load_provider(provider_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """SELECT "baseUrl", "encryptedApiKey", headers, "defaultModel", kind,
                  "reasoningEffort", "chatTemplateKwargs"
           FROM "ProviderCredential" WHERE id = $1""",
        provider_id,
    )
    if not row:
        raise RuntimeError(f"provider not found: {provider_id}")
    return dict(row)


async def _load_language_profile(profile_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """
        SELECT id, "primary", secondary, script,
               "codeSwitchPolicy", "codeSwitchRate",
               register, "allowParticles",
               "bannedTokens", "bannedPatterns", "requireBahasaBaku",
               "englishLoanwordPolicy", "loanwordAllowlist"
        FROM "LanguageProfile" WHERE id = $1
        """,
        profile_id,
    )
    if not row:
        raise RuntimeError(f"language profile not found: {profile_id}")
    return dict(row)


async def _load_persona(persona_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """
        SELECT id, name, ethnicity, region, urbanity, "ageRange",
               formality, "dialectTags", "languageProfileId"
        FROM "Persona" WHERE id = $1
        """,
        persona_id,
    )
    return dict(row) if row else None


async def _load_taxonomy_node(node_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """SELECT id, name, slug, path FROM "TaxonomyNode" WHERE id = $1""",
        node_id,
    )
    return dict(row) if row else None


async def _load_knowledge_entries(
    project_id: str, node_id: str | None
) -> list[dict[str, Any]]:
    """Return KB entries that should be injected for this generation:
    - any entry with empty taxonomyNodeIds (project-wide catch-all), OR
    - entries whose taxonomyNodeIds contains the primary node_id.
    Sorted newest-first; capped at 20 so the system prompt doesn't explode.
    """
    rows = await db.fetch_all(
        '''
        SELECT id, title, content, "sourceUrl", tags, "taxonomyNodeIds"
        FROM "KnowledgeBaseEntry"
        WHERE "projectId" = $1
          AND (
            cardinality("taxonomyNodeIds") = 0
            OR ($2::text IS NOT NULL AND $2 = ANY("taxonomyNodeIds"))
          )
        ORDER BY "createdAt" DESC
        LIMIT 20
        ''',
        project_id,
        node_id,
    )
    return [dict(r) for r in rows]


def _format_knowledge_block(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return ""
    parts: list[str] = ["## Knowledge base", ""]
    for i, e in enumerate(entries, start=1):
        src = f" [source: {e['sourceUrl']}]" if e.get("sourceUrl") else ""
        parts.append(f"### {i}. {e['title']}{src}")
        parts.append(str(e.get("content") or "").strip())
        parts.append("")
    return "\n".join(parts).strip()


async def _pick_related_nodes(
    project_id: str, exclude_id: str | None, n: int
) -> list[str]:
    """Random sample N taxonomy node names from the project (excluding the
    primary). Used by the lightweight multi-topic conversation knob."""
    if n <= 0:
        return []
    rows = await db.fetch_all(
        """SELECT tn.name FROM "TaxonomyNode" tn
           JOIN "Taxonomy" t ON t.id = tn."taxonomyId"
           WHERE t."projectId" = $1
             AND ($2::text IS NULL OR tn.id <> $2)
           ORDER BY random()
           LIMIT $3""",
        project_id,
        exclude_id,
        n,
    )
    return [r["name"] for r in rows]


def _snapshot_persona(p: dict[str, Any] | None) -> dict[str, Any] | None:
    if not p:
        return None
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "ethnicity": p.get("ethnicity"),
        "region": p.get("region"),
        "urbanity": p.get("urbanity"),
        "ageRange": p.get("ageRange"),
        "formality": p.get("formality"),
        "dialectTags": list(p.get("dialectTags") or []),
    }


async def _emit_event(job_id: str, run_id: str, **payload: Any) -> None:
    """Emit a structured pg_notify event on the synthgen_job channel. The SSE
    route forwards every field verbatim; the live preview client decides how to
    render based on `event`. Best-effort — never throws."""
    try:
        async with db.acquire() as ncon:
            await ncon.execute(
                "SELECT pg_notify('synthgen_job', $1)",
                json.dumps(
                    {"jobId": job_id, "runId": run_id, **payload},
                    ensure_ascii=False,
                ),
            )
    except Exception:  # noqa: BLE001
        pass


# pg_notify caps each payload at ~8000 bytes. Persona + tool catalog + rules
# can produce a 6-10KB system prompt for the user simulator, so we truncate
# the SSE-visible copy and keep the full one in JobEvent for the trace.
_SIM_REQUEST_SSE_MAX = 5500


async def _emit_simulator_request(
    *,
    job_id: str,
    run_id: str,
    purpose: str,
    model: str,
    system: str,
    user_msg: str,
    temperature: float,
    max_tokens: int,
) -> None:
    """Surface the EXACT request sent to the LLM to generate a user turn.

    Two surfaces:
      1. `pg_notify` event `simulator.request` so the Live job preview can
         render an expandable "before this user turn" card. System prompt is
         clipped to keep us under Postgres' 8000-byte NOTIFY limit.
      2. `JobEvent` row of kind `user.simulator.request` carrying the FULL
         system + user content for the trace timeline / replay path.
    """
    system_chars = len(system)
    truncated = system_chars > _SIM_REQUEST_SSE_MAX
    system_for_sse = system[:_SIM_REQUEST_SSE_MAX] if truncated else system
    await _emit_event(
        job_id,
        run_id,
        event="simulator.request",
        purpose=purpose,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        system=system_for_sse,
        user_msg=user_msg,
        system_chars=system_chars,
        truncated=truncated,
    )
    await _log_event(
        job_id,
        "user.simulator.request",
        {
            "purpose": purpose,
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "system": system,
            "user": user_msg,
        },
    )


async def _stream_simulator_completion(
    *,
    job_id: str | None,
    run_id: str | None,
    purpose: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
) -> dict[str, Any]:
    """Streaming variant of `chat_completion` used only by the user-simulator
    helpers. Emits one `simulator.delta` SSE event per chunk (with the
    `purpose` and a `reasoning` flag) so the live preview can render the
    simulator's chain-of-thought + final user utterance materializing inside
    the same collapsible card that shows the simulator's system prompt.

    Returns a dict matching the subset of fields the callers need from
    chat_completion (`content`, `reasoning_content`, `tokens_in`,
    `tokens_out`, `cost_usd`, `model`).
    """
    from .providers import chat_completion_stream, estimate_cost

    # Retry on 0-token responses. The upstream proxy `serverlessgpu.aies.…`
    # intermittently returns HTTP 200 with usage.completion_tokens=0 and an
    # empty stream — looks like a successful call but produced nothing. We
    # used to silently fall through to the seed-text / "Boleh terangkan
    # lagi?" stubs; now we retry up to 3 times with backoff before giving
    # up, and we log each empty attempt loudly so flakiness is visible.
    SIM_RETRIES = 3
    full_content = ""
    full_reasoning = ""
    tokens_in = 0
    tokens_out = 0
    upstream_model = model
    for attempt in range(1, SIM_RETRIES + 1):
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_headers=extra_headers,
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=chat_template_kwargs,
        ):
            if ev.done:
                tokens_in = ev.tokens_in
                tokens_out = ev.tokens_out
                if ev.model:
                    upstream_model = ev.model
                break
            if not ev.delta:
                continue
            if ev.reasoning:
                reasoning_parts.append(ev.delta)
            else:
                content_parts.append(ev.delta)
            if job_id and run_id:
                await _emit_event(
                    job_id,
                    run_id,
                    event="simulator.delta",
                    purpose=purpose,
                    reasoning=bool(ev.reasoning),
                    text=ev.delta,
                )

        full_content = "".join(content_parts)
        full_reasoning = "".join(reasoning_parts)
        if full_content.strip() or tokens_out > 0:
            break
        # Empty stream — record it and back off briefly before trying again.
        if job_id:
            await _log_event(
                job_id,
                "user.simulator.empty",
                {
                    "purpose": purpose,
                    "attempt": attempt,
                    "of": SIM_RETRIES,
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "model": upstream_model,
                },
            )
        log.warning(
            "simulator returned 0 tokens (purpose=%s attempt=%d/%d "
            "model=%s tokens_in=%d) — retrying",
            purpose, attempt, SIM_RETRIES, upstream_model, tokens_in,
        )
        if attempt < SIM_RETRIES:
            await asyncio.sleep(1.5 * attempt)
    # Persist the simulator response so the replay path on a refresh / late
    # subscriber can synthesize the same `simulator.delta` events from the
    # saved text — without this, only LIVE viewers see the streaming reply
    # and anyone re-opening the job sees the request card with a blank
    # "Waiting for simulator response…" state.
    if job_id:
        await _log_event(
            job_id,
            "user.simulator.response",
            {
                "purpose": purpose,
                "model": upstream_model,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "content": full_content,
                "reasoning_content": full_reasoning or None,
            },
        )

    return {
        "content": full_content,
        "reasoning_content": full_reasoning or None,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": estimate_cost(upstream_model, tokens_in, tokens_out),
        "model": upstream_model,
    }


async def _log_event(job_id: str, kind: str, payload: dict[str, Any] | None = None) -> None:
    """Append a step in the job's trace timeline.

    Never throws — but logs failures *loudly* at ERROR level with the actual
    exception text. Previously this swallowed everything via `log.exception`,
    which left users staring at empty Build timelines for jobs that had
    silently failed every JobEvent insert (e.g. transient pool exhaustion or
    a schema mismatch after a migration). Now you'll see a clear marker in
    the worker logs that something needs fixing.
    """
    try:
        # IMPORTANT: pass the dict directly — the asyncpg jsonb codec
        # registered in db.py wraps `json.dumps`, so pre-stringifying causes
        # a DOUBLE encoding and the column ends up storing `"{\"a\": 1}"`
        # (a JSON string of a JSON string) instead of `{"a": 1}`. Replay
        # paths that do `typeof payload === "object"` then silently skip
        # the row. Same fix the assistant-Message insert at line ~2353 uses
        # for `toolCalls`.
        await db.execute(
            'INSERT INTO "JobEvent" (id, "jobId", kind, payload, ts) VALUES ($1, $2, $3, $4::jsonb, NOW())',
            cuid_like(),
            job_id,
            kind,
            payload,
        )
    except Exception as exc:  # noqa: BLE001
        # ERROR (not just exception) so it stands out in `docker compose logs`,
        # and include the exception class + message in the line itself so
        # grepping for "JOBEVENT_INSERT_FAILED" surfaces every occurrence.
        log.error(
            "JOBEVENT_INSERT_FAILED job=%s kind=%s err=%s: %s",
            job_id, kind, type(exc).__name__, exc,
            exc_info=True,
        )


async def _load_template(template_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """SELECT id, name, kind, body FROM "PromptTemplate" WHERE id = $1""",
        template_id,
    )
    if not row:
        raise RuntimeError(f"template not found: {template_id}")
    return dict(row)


def _resolve_formality(
    *,
    run_policy: str,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
) -> FormalityPolicy:
    """Apply the precedence: Run > Persona > LanguageProfile > project default."""
    register = lp.get("register") or "formal"
    allow_particles = bool(lp.get("allowParticles", False))

    if run_policy and run_policy != "inherit":
        register = run_policy
        if run_policy == "formal":
            allow_particles = False
    elif persona and persona.get("formality"):
        f = persona["formality"]
        if f == "baku":
            register = "formal"
            allow_particles = False
        elif f in {"colloquial", "manglish"}:
            register = "colloquial"
            allow_particles = True

    return FormalityPolicy(
        register=register,
        allow_particles=allow_particles,
        require_formal_malay=bool(lp.get("requireBahasaBaku", False)),
        english_loanword_policy=lp.get("englishLoanwordPolicy") or "free",
        loanword_allowlist=list(lp.get("loanwordAllowlist") or []),
        primary=lp.get("primary") or "ms",
    )


def _summarize_tools_for_user(tool_defs: list[dict[str, Any]]) -> str:
    """Per-tool block for prompting the user simulator. Includes name,
    description, parameter shape (name + type + which are required), and one
    realistic example argument set (from ToolDef.examples) so the simulator
    knows what kind of identifying info the user should naturally provide —
    e.g. quoting a real 12-digit MyKad rather than a vague "my IC".
    """
    if not tool_defs:
        return ""
    lines: list[str] = []
    for t in tool_defs[:20]:
        name = t.get("name") or "?"
        desc = (t.get("description") or "").strip().replace("\n", " ")
        if len(desc) > 200:
            desc = desc[:200] + "…"

        # Parameter schema → "<arg> (<type>, required)" bullets.
        params = t.get("parameters") or {}
        props = (params.get("properties") if isinstance(params, dict) else None) or {}
        required_list = set(params.get("required") or []) if isinstance(params, dict) else set()
        param_bits: list[str] = []
        for pname, pschema in list(props.items())[:8]:
            if not isinstance(pschema, dict):
                continue
            ptype = pschema.get("type") or "any"
            pdesc = (pschema.get("description") or "").strip().replace("\n", " ")
            if len(pdesc) > 80:
                pdesc = pdesc[:80] + "…"
            tag = "required" if pname in required_list else "optional"
            extra = f" — {pdesc}" if pdesc else ""
            # Surface common constraints so the simulator emits valid-shaped values.
            constraints: list[str] = []
            if isinstance(pschema.get("enum"), list) and pschema["enum"]:
                vals = ", ".join(str(v) for v in pschema["enum"][:6])
                constraints.append(f"enum: {vals}")
            if pschema.get("pattern"):
                constraints.append(f"pattern: {pschema['pattern']}")
            if pschema.get("format"):
                constraints.append(f"format: {pschema['format']}")
            if pschema.get("minimum") is not None or pschema.get("maximum") is not None:
                constraints.append(
                    f"range: [{pschema.get('minimum', '-∞')}..{pschema.get('maximum', '∞')}]",
                )
            cstr = f" ({'; '.join(constraints)})" if constraints else ""
            param_bits.append(f"    - {pname} ({ptype}, {tag}){extra}{cstr}")

        # One realistic example so the simulator can quote concrete values.
        examples = t.get("examples")
        example_text = ""
        if isinstance(examples, list) and examples:
            first = examples[0]
            try:
                example_text = f"\n    example args: {json.dumps(first, ensure_ascii=False)}"
            except Exception:  # noqa: BLE001
                example_text = ""

        block = f"- {name}: {desc or '(no description)'}"
        if param_bits:
            block += "\n  parameters:\n" + "\n".join(param_bits)
        block += example_text
        lines.append(block)
    return "\n".join(lines)


def _looks_like_system_prompt(out: str) -> bool:
    """Heuristic: does this LLM output read like a system prompt (i.e.
    assistant-side framing) rather than a customer-side first-person
    utterance? Used as a hard validator on user-1 generation — we'd
    rather emit a short canned customer message than render second-person
    instructions as the first user turn.
    """
    if not out:
        return True
    head = " ".join(out.split())[:120].lower()
    return head.startswith(
        (
            "you are ",
            "you must ",
            "you should ",
            "you will ",
            "act as ",
            "speak in ",
            "respond in ",
            "base your communication",
            "you write ",
            "your role is",
            "as a ",
        )
    )


def _synthesize_customer_opening(
    persona: dict[str, Any] | None, lp: dict[str, Any], tool_defs: list[dict[str, Any]] | None,
) -> str:
    """Last-resort customer opening for when the LLM keeps producing
    system-prompt-style output. Persona-anchored, first-person, and
    deliberately short so it's obvious in the dataset that this fallback
    fired. Returns plain text suitable as a user turn.
    """
    region = ""
    if persona:
        region = persona.get("region") or ""
    lang = (lp.get("primary") or "ms").lower() if lp else "ms"
    # Bahasa Melayu and English variants of the same generic opener; pick
    # by language code so the message at least fits the target locale.
    if lang.startswith("ms"):
        base = "Hi, saya nak minta bantuan untuk akaun saya."
        if region:
            base = f"Hi, saya dari {region}. " + base
    else:
        base = "Hi, I need some help with my account."
        if region:
            base = f"Hi, I'm in {region}. " + base
    if tool_defs:
        # Hint at intent so the model is more likely to pick a tool on the
        # next turn — but stay generic enough to not constrain.
        base += " Can you check what's going on?"
    return base


# Legacy alias retained for any caller that still imports the old name.
def _looks_like_echo(out: str, seed: str) -> bool:  # noqa: ARG001
    return _looks_like_system_prompt(out)


async def _generate_tool_aware_user_text(
    *,
    fallback_text: str,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
    policy: FormalityPolicy,
    tool_defs: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
) -> tuple[str, int, int, float]:
    """Generate the FIRST user message such that it naturally requires the
    assistant to invoke one of the available tools.

    `fallback_text` is the rendered template body — kept only as the
    legacy parameter name; we DO NOT pass it to the LLM anymore because
    weaker models routinely echo the body verbatim regardless of how
    strongly we instruct them not to. User turn 1 is now generated purely
    from persona + tools + locale rules. If the LLM still produces
    system-prompt-style output, we substitute a short synthesized customer
    opening rather than rendering it. The template body is never used as
    the visible first user turn.

    Returns (text, tokens_in, tokens_out, cost).
    """
    if not tool_defs:
        return fallback_text, 0, 0, 0.0
    persona_lines: list[str] = []
    if persona:
        for k in ("name", "description", "ethnicity", "region", "urbanity", "ageRange", "formality"):
            v = persona.get(k)
            if v:
                persona_lines.append(f"- {k}: {v}")
        if persona.get("dialectTags"):
            persona_lines.append(f"- dialectTags: {', '.join(persona['dialectTags'])}")
    persona_block = "\n".join(persona_lines) or "(none — generic Malaysian customer)"
    tools_block = _summarize_tools_for_user(tool_defs)
    language = lp.get("primary") or "ms"
    register = policy.register

    # Build the leak sets so we can scrub the model's output for tool /
    # parameter / enum names if the prompt's "don't name the API" rule is
    # ignored.
    tool_names_to_hide: set[str] = set()
    enum_values_to_hide: set[str] = set()
    for t in tool_defs:
        name = t.get("name")
        if isinstance(name, str):
            tool_names_to_hide.add(name)
        params = t.get("parameters") or {}
        props = params.get("properties") if isinstance(params, dict) else None
        if isinstance(props, dict):
            for pname, pschema in props.items():
                if isinstance(pname, str):
                    tool_names_to_hide.add(pname)
                if isinstance(pschema, dict):
                    enums = pschema.get("enum")
                    if isinstance(enums, list):
                        for v in enums:
                            if isinstance(v, str):
                                enum_values_to_hide.add(v)

    sys = (
        "You write a realistic OPENING USER MESSAGE for a synthetic "
        "customer-support conversation. Speak in FIRST PERSON as the CUSTOMER. "
        "The assistant has function-calling tools available; your message must "
        "give it a real reason to invoke at least one of them.\n\n"
        f"Persona:\n{persona_block}\n\n"
        f"Target language: {language} (register: {register}).\n\n"
        f"Available tools the assistant can call:\n{tools_block}\n\n"
        "Hard rules:\n"
        "- 1-3 sentences. FIRST PERSON. From the CUSTOMER's perspective.\n"
        "- NEVER start with 'You are…', 'You must…', 'Act as…', 'Speak in…', "
        "  'Base your communication…', 'As a…' — that's assistant-side framing.\n"
        "- DO NOT write instructions, role descriptions, register/banned-token "
        "  policies, taxonomy paths, or any meta content. Only what a real "
        "  customer would type.\n"
        "- Pick ONE tool (or two related tools) to target. The user shouldn't say "
        "  the tool's name — just describe what they need such that the assistant "
        "  will obviously call that tool.\n"
        "- For each REQUIRED parameter on the chosen tool, weave a realistic value "
        "  into the user's message: match the parameter's `type`, `pattern`, "
        "  `format`, `enum`, and range constraints exactly. Use the `example args` "
        "  shown above as a guide for what plausible values look like, but vary "
        "  the actual values so they don't repeat.\n"
        "- ABSOLUTELY FORBIDDEN: do NOT name the function/tool (no 'fraud_report', "
        "  no 'check_account', no snake_case identifiers); do NOT say internal "
        "  parameter names ('account_id', 'tone'); do NOT mention internal enum "
        "  values like 'casual_manglish' or 'formal_baku' — speak the language "
        "  naturally instead; do NOT write phrases like 'process this as X', "
        "  'call X for me', 'using X tone'.\n"
        "- NO markdown formatting at all — no **bold**, no _italics_, no `backticks`.\n"
        "- Locale (Malaysia): MyKad = 12-digit `^\\d{6}-\\d{2}-\\d{4}$`, mobile = "
        "  `^\\+?60\\d{9,10}$`, MYR amounts are decimals, ISO dates are `YYYY-MM-DD`, "
        "  state codes from {KUL,SGR,PNG,JHR,KTN,TRG,KDH,PRK,MLK,NSN,PHG,PLS,SBH,SWK,PJY,LBN}.\n"
        "- Reply with ONLY the user's utterance — no role tag, no quotes, no preamble, "
        "  no markdown, no labelled fields like `IC: ...`."
    )

    # `/no_think` is a Qwen3 chat-template directive — honored regardless of
    # proxy chain. Belt-and-suspenders alongside `chat_template_kwargs:
    # {enable_thinking: false}` (which some proxies strip). Non-Qwen models
    # treat it as harmless literal text.
    user_msg = "/no_think\n\nWrite the opening user message now."
    # Raised from 300 → 800: with thinking off this is far more than needed,
    # but if a proxy leaks reasoning past our defenses, 300 tokens was tight
    # enough that the actual answer got truncated to empty content.
    sim_max_tokens = 800
    if job_id and run_id:
        # Surface the exact request that's about to be sent so the Live preview
        # can render a "User-simulator request · turn 1" card BEFORE the user
        # turn it produced. Also persisted to JobEvent for the trace timeline.
        await _emit_simulator_request(
            job_id=job_id,
            run_id=run_id,
            purpose="user_turn_1_tool_aware",
            model=model,
            system=sys,
            user_msg=user_msg,
            temperature=0.8,
            max_tokens=sim_max_tokens,
        )

    try:
        r = await _stream_simulator_completion(
            job_id=job_id,
            run_id=run_id,
            purpose="user_turn_1_tool_aware",
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.8,
            max_tokens=sim_max_tokens,
            extra_headers=extra_headers,
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=chat_template_kwargs,
        )
        text = (r["content"] or "").strip().strip('"').strip("'")
        if _looks_like_system_prompt(text):
            log.warning(
                "tool-aware user-text returned system-prompt-style output "
                "(model=%s) — substituting synthesized customer opening",
                model,
            )
            text = _synthesize_customer_opening(persona, lp, tool_defs)
        else:
            text = _scrub_user_turn(text, tool_names_to_hide, enum_values_to_hide)
        return (
            (text or _synthesize_customer_opening(persona, lp, tool_defs)),
            r["tokens_in"],
            r["tokens_out"],
            r["cost_usd"],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("tool-aware user-text generation failed: %s", e)
        return _synthesize_customer_opening(persona, lp, tool_defs), 0, 0, 0.0


async def _generate_seed_user_text(
    *,
    seed_text: str,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
    policy: FormalityPolicy,
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
) -> tuple[str, int, int, float]:
    """Generate the FIRST user message from a user-seed template body.

    The seed_text is treated as INSTRUCTIONS describing what the customer
    wants (or an example utterance to riff on) — NOT as the literal first
    user turn. The LLM rewrites it into an in-character customer message.

    This is intentional: user-seed template bodies authored by the bootstrap
    flow are scenario hints / instructions, not chat lines. Rendering them
    verbatim as turn 1 leaks template-style or second-person assistant
    framing into the conversation. Routing through the LLM produces a
    realistic customer utterance regardless of how the seed was authored.

    Returns (text, tokens_in, tokens_out, cost). On error, falls back to
    `seed_text` so the conversation still proceeds with degraded quality
    rather than crashing the job.
    """
    persona_lines: list[str] = []
    if persona:
        for k in ("name", "description", "ethnicity", "region", "urbanity", "ageRange", "formality"):
            v = persona.get(k)
            if v:
                persona_lines.append(f"- {k}: {v}")
        if persona.get("dialectTags"):
            persona_lines.append(f"- dialectTags: {', '.join(persona['dialectTags'])}")
    persona_block = "\n".join(persona_lines) or "(none — generic Malaysian customer)"
    language = lp.get("primary") or "ms"
    register = policy.register

    sys = (
        "You write a realistic OPENING USER MESSAGE for a synthetic "
        "customer-support conversation. Speak in FIRST PERSON as the CUSTOMER. "
        "Produce a single utterance the customer would type into chat to "
        "initiate the conversation.\n\n"
        f"Persona:\n{persona_block}\n\n"
        f"Target language: {language} (register: {register}).\n\n"
        "Hard rules:\n"
        "- 1-3 sentences. FIRST PERSON. From the CUSTOMER's perspective.\n"
        "- NEVER start with 'You are…', 'You must…', 'Act as…', 'Speak in…', "
        "  'Base your communication…', 'As a…' — that's assistant-side framing.\n"
        "- DO NOT write instructions, role descriptions, register/banned-token "
        "  policies, taxonomy paths, or any meta content. Only what a real "
        "  customer would type.\n"
        "- Include any concrete identifiers (account numbers, IC, phone, dates) "
        "  that the scenario suggests would be present, in realistic Malaysian formats.\n"
        "- Reply with ONLY the user's utterance — no role tag, no quotes, no preamble, "
        "  no markdown, no labelled fields."
    )

    # See `_generate_tool_aware_user_text` for the rationale on `/no_think`
    # and the 800-token cap — same belt-and-suspenders against proxies that
    # strip chat_template_kwargs and let reasoning models eat the budget.
    user_msg = "/no_think\n\nWrite the opening user message now."
    seed_max_tokens = 800
    if job_id and run_id:
        await _emit_simulator_request(
            job_id=job_id,
            run_id=run_id,
            purpose="user_turn_1_seed",
            model=model,
            system=sys,
            user_msg=user_msg,
            temperature=0.8,
            max_tokens=seed_max_tokens,
        )

    try:
        r = await _stream_simulator_completion(
            job_id=job_id,
            run_id=run_id,
            purpose="user_turn_1_seed",
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.8,
            max_tokens=seed_max_tokens,
            extra_headers=extra_headers,
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=chat_template_kwargs,
        )
        text = (r["content"] or "").strip().strip('"').strip("'")
        if _looks_like_system_prompt(text):
            log.warning(
                "seed user-text returned system-prompt-style output "
                "(model=%s) — substituting synthesized customer opening",
                model,
            )
            text = _synthesize_customer_opening(persona, lp, None)
        return (
            (text or _synthesize_customer_opening(persona, lp, None)),
            r["tokens_in"],
            r["tokens_out"],
            r["cost_usd"],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("seed user-text generation failed: %s", e)
        return _synthesize_customer_opening(persona, lp, None), 0, 0, 0.0


async def _simulate_user_turn(
    *,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
    policy: FormalityPolicy,
    transcript: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
    max_tokens: int,
    tool_defs: list[dict[str, Any]] | None = None,
    turn_number: int = 2,
    total_turns: int = 1,
    job_id: str | None = None,
    run_id: str | None = None,
) -> tuple[str, int, int, float]:
    """Generate the next user-side utterance for a multi-turn conversation.

    The same LLM that powers the assistant is asked to role-play the *user*
    given the persona + conversation so far. Returns (text, tokens_in,
    tokens_out, cost).

    `turn_number` / `total_turns` (1-indexed) are passed in so the simulator
    knows how far through the conversation it is — early turns must keep the
    dialog going, only the last turn may bail out with "[END]" (and only if
    it's the genuinely natural place to stop).
    """
    persona_lines: list[str] = []
    if persona:
        for k in ("name", "description", "ethnicity", "region", "urbanity", "ageRange", "formality"):
            v = persona.get(k)
            if v:
                persona_lines.append(f"- {k}: {v}")
        if persona.get("dialectTags"):
            persona_lines.append(f"- dialectTags: {', '.join(persona['dialectTags'])}")
    persona_block = "\n".join(persona_lines) or "(none — use a generic Malaysian customer voice)"

    # We never invite [END] while we're still inside the planned range — even on
    # the "last" turn — because total_turns is the user-requested CONVERSATION
    # length and the model would otherwise cut it short by one turn. The loop
    # caller only honors an exact "[END]" reply as a defensive safety valve.

    # If tools are configured, list them so the simulator can pick a follow-up
    # that nudges the assistant to invoke a *different* tool than the one(s)
    # already called. We figure out which ones have been called by walking
    # the transcript's tool messages.
    already_called: set[str] = set()
    for m in transcript:
        if m.get("role") == "assistant":
            for tc in m.get("tool_calls") or []:
                name = (tc.get("function") or {}).get("name") if isinstance(tc, dict) else None
                if isinstance(name, str):
                    already_called.add(name)
    # Collect tool/parameter/enum names so we can both prompt against them
    # and scrub them out of the output if the model still leaks.
    tool_names_to_hide: set[str] = set()
    enum_values_to_hide: set[str] = set()
    if tool_defs:
        for t in tool_defs:
            name = t.get("name")
            if isinstance(name, str):
                tool_names_to_hide.add(name)
            params = t.get("parameters") or {}
            props = params.get("properties") if isinstance(params, dict) else None
            if isinstance(props, dict):
                for pname, pschema in props.items():
                    if isinstance(pname, str):
                        tool_names_to_hide.add(pname)
                    if isinstance(pschema, dict):
                        enums = pschema.get("enum")
                        if isinstance(enums, list):
                            for v in enums:
                                if isinstance(v, str):
                                    enum_values_to_hide.add(v)

    tool_hint = ""
    if tool_defs:
        unused = [t for t in tool_defs if (t.get("name") or "") not in already_called]
        target_pool = unused if unused else tool_defs
        tool_lines = _summarize_tools_for_user(target_pool)
        if tool_lines:
            tool_hint = (
                "\n\nThe assistant has these function-calling tools available "
                "(prefer ones it hasn't used yet — push it to cover more of them):\n"
                f"{tool_lines}\n"
                "Phrase your next message so the assistant has a real reason to invoke "
                "ONE of these tools. For each REQUIRED parameter on the chosen tool, "
                "weave a realistic value into your message that matches the parameter's "
                "type / pattern / enum / format constraints (see the schema lines above; "
                "use the `example args` as a shape guide but don't copy them verbatim). "
                "Locale: MyKad `^\\d{6}-\\d{2}-\\d{4}$`, mobile `^\\+?60\\d{9,10}$`, "
                "ISO dates `YYYY-MM-DD`.\n\n"
                "ABSOLUTELY FORBIDDEN — these are internal developer names the customer "
                "would NEVER say:\n"
                "- DO NOT name any function/tool. No 'fraud_report', no 'check_account', "
                "  no snake_case identifiers anywhere in the message.\n"
                "- DO NOT say internal parameter names ('account_id', 'tone', 'tier').\n"
                "- DO NOT mention internal enum values like 'casual_manglish' or "
                "  'formal_baku' — speak the language naturally instead.\n"
                "- DO NOT write phrases like 'process this as X', 'call X for me', "
                "  'use X tool', 'using X tone'. Customers describe their problem, "
                "  they do not name the API.\n"
                "- NO markdown formatting at all. No **bold**, no _italics_, no "
                "  `backticks`, no asterisks around any word.\n"
                "- Just describe the problem like a real customer chatting in a bank "
                "  app. Mention concrete details (amount, account number, date) when "
                "  natural, but never the API mechanics."
            )

    sys = (
        "You are role-playing the USER side of a Malaysian customer-support conversation. "
        "Given the persona profile and conversation transcript so far, write ONLY the user's "
        "next message — 1-3 sentences, in the persona's voice and language register.\n\n"
        f"Persona:\n{persona_block}\n\n"
        f"Target language: {lp.get('primary') or 'ms'} (register: {policy.register}).\n"
        f"You are producing user turn {turn_number} of {total_turns} planned turns "
        f"({total_turns - turn_number} more turn(s) will follow after this one).\n"
        "Hard rules:\n"
        "- Reply with ONLY the user's next utterance — no role tag, no quotes, no preamble.\n"
        "- NO markdown formatting at all — no **bold**, no _italics_, no `backticks`.\n"
        "- Stay in character. React naturally to the assistant's last message: ask a follow-up, "
        "  push back on something, clarify, escalate, or introduce an adjacent need.\n"
        "- Do NOT wrap the conversation up yet. The script expects you to keep going for "
        f"  {max(0, total_turns - turn_number)} more turn(s) after this one. Don't say goodbye, "
        "  don't thank-and-close, don't reply with [END]."
        + tool_hint
    )

    transcript_lines: list[str] = []
    for m in transcript:
        role = (m.get("role") or "?").upper()
        if role == "SYSTEM":
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        transcript_lines.append(f"[{role}] {content}")
    transcript_text = "\n\n".join(transcript_lines) or "(empty)"

    # Keep the run's `enable_thinking` setting as-is so reasoning models can
    # produce a visible <think> block — that gets streamed via `simulator.delta
    # · reasoning=true` and shown inside the simulator-request card for turn N
    # (the same surface turn 1 already gets). We rely on the loop's empty-turn
    # fallback ("Boleh terangkan lagi?", `turn.user.empty` JobEvent) to keep
    # the conversation alive if the model still spends the whole budget on
    # reasoning and leaves `content` empty — the worst case is one degraded
    # turn, not a silently dropped one.
    sim_kwargs = dict(chat_template_kwargs or {})

    # `/no_think` is a Qwen3 directive that disables reasoning for this
    # turn regardless of whether the upstream proxy honors
    # `chat_template_kwargs.enable_thinking`. Without this, follow-up
    # simulator turns can spend the entire max_tokens budget inside
    # <think> and emit empty content — the "Boleh terangkan lagi?"
    # fallback path. Other model families treat it as literal text and
    # ignore it. We ALSO cap max_tokens for the simulator at 1200; the
    # run's max_tokens is sized for assistant turns that may include
    # reasoning + a long answer, but user messages don't need that much
    # — a leaked-reasoning attempt would otherwise burn 8k tokens to
    # produce nothing.
    user_msg = f"/no_think\n\nTranscript so far:\n{transcript_text}"
    sim_turn_max_tokens = min(int(max_tokens or 1200), 1200)
    if job_id and run_id:
        # Same "preflight" surfacing as turn 1: render a card in the live
        # preview before the user-turn-N card so reviewers can see exactly
        # what context the simulator was given.
        await _emit_simulator_request(
            job_id=job_id,
            run_id=run_id,
            purpose=f"user_turn_{turn_number}",
            model=model,
            system=sys,
            user_msg=user_msg,
            temperature=0.8,
            max_tokens=sim_turn_max_tokens,
        )

    try:
        r = await _stream_simulator_completion(
            job_id=job_id,
            run_id=run_id,
            purpose=f"user_turn_{turn_number}",
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.8,
            # Capped via sim_turn_max_tokens — see comment near user_msg.
            # The run's full max_tokens budget is sized for assistant turns
            # that may include reasoning + a long answer; a user turn is
            # 1-3 sentences, so letting reasoning leak into 8k tokens just
            # to emit two sentences is wasteful and risks empty content.
            max_tokens=sim_turn_max_tokens,
            extra_headers=extra_headers,
            # Forward the provider's reasoning_effort so reasoning models
            # (Mistral with --reasoning-parser, OpenAI o-series) emit a
            # visible <think> block that the live preview can stream as
            # `simulator.delta · reasoning=true`. The earlier override to
            # None saved a few tokens but left the simulator card empty
            # for Mistral while Qwen kept its CoT (Qwen3's chat template
            # defaults thinking ON regardless of reasoning_effort). The
            # max_tokens budget here is the run's full budget (≥8192 in
            # tool-mode runs), so reasoning + content both have room.
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=sim_kwargs,
        )
        text = (r["content"] or "").strip().strip('"').strip("'")
        text = _scrub_user_turn(text, tool_names_to_hide, enum_values_to_hide)
        return text, r["tokens_in"], r["tokens_out"], r["cost_usd"]
    except Exception as e:  # noqa: BLE001
        log.warning("user simulator failed: %s", e)
        return "[END]", 0, 0, 0.0


# Compiled once at module load — used by _scrub_user_turn.
_MD_BOLD_RE = re.compile(r"\*\*([^*]+?)\*\*")
_MD_ITALIC_UNDERSCORE_RE = re.compile(r"\b_([^_]+?)_\b")
_MD_ITALIC_STAR_RE = re.compile(r"(?<!\*)\*([^*]+?)\*(?!\*)")
_MD_BACKTICK_RE = re.compile(r"`([^`]+?)`")
_SNAKE_CASE_RE = re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")


def _scrub_user_turn(text: str, tool_names: set[str], enum_values: set[str]) -> str:
    """Strip markdown emphasis and remove leaked API identifiers from a
    simulated user turn. The simulator routinely outputs phrases like
    "process this as **fraud_report** for account **123** using **casual_manglish**"
    despite the prompt forbidding it — those strings break the realism of
    the dataset because no real customer writes the function name out
    loud. We unwrap markdown (keeping the inner text), then redact any
    surviving tool / parameter / enum names with `[…]` so reviewers can
    spot the leak instead of it being silently shipped.
    """
    if not text:
        return text
    # Unwrap markdown: keep inner content, drop the markup characters.
    text = _MD_BOLD_RE.sub(r"\1", text)
    text = _MD_ITALIC_UNDERSCORE_RE.sub(r"\1", text)
    text = _MD_ITALIC_STAR_RE.sub(r"\1", text)
    text = _MD_BACKTICK_RE.sub(r"\1", text)

    def _redact(token: str) -> str:
        return "[…]" if token else token

    # Redact known tool / parameter / enum names verbatim.
    for name in sorted(tool_names | enum_values, key=len, reverse=True):
        if not name:
            continue
        text = re.sub(
            r"\b" + re.escape(name) + r"\b",
            _redact(name),
            text,
            flags=re.IGNORECASE,
        )

    # Redact any remaining snake_case identifier the model invented — real
    # customers never type snake_case.
    text = _SNAKE_CASE_RE.sub("[…]", text)

    # Collapse double-spaces left by removals.
    return re.sub(r" {2,}", " ", text).strip()


async def _resolve_tool_names(tool_ids: list[str]) -> list[dict[str, str]]:
    """Look up tool names for a list of ToolDef ids. Tool ids that don't resolve
    are silently dropped so a deleted tool doesn't break the snapshot."""
    if not tool_ids:
        return []
    rows = await db.fetch_all(
        'SELECT id, name FROM "ToolDef" WHERE id = ANY($1::text[])',
        list(tool_ids),
    )
    out: list[dict[str, str]] = []
    for r in rows:
        out.append({"id": r["id"], "name": r["name"]})
    return out


async def _settings_snapshot(
    *,
    run: dict[str, Any],
    persona: dict[str, Any] | None,
    node: dict[str, Any] | None,
    lp: dict[str, Any],
    template: dict[str, Any] | None,
    provider: dict[str, Any],
    policy: FormalityPolicy,
    sampling: dict[str, Any],
    difficulty: str | None,
    mode: str,
    flow: dict[str, Any] | None = None,
    tools_invoked: list[dict[str, Any]] | None = None,
    tool_ids_override: list[str] | None = None,
) -> dict[str, Any]:
    """Build the per-conversation settings snapshot. Stored as JSON on
    Conversation.settingsSnapshot so users can answer 'what produced this row?'
    without joining back to the run (which can be edited later).
    """
    cfg = _as_dict(run.get("configSnapshot"))
    tool_ids = tool_ids_override if tool_ids_override is not None else (cfg.get("toolIds") or [])
    tool_names = await _resolve_tool_names([t for t in tool_ids if isinstance(t, str)])
    return {
        "mode": mode,
        "model": run.get("model"),
        "providerCredentialId": run.get("providerCredentialId"),
        "providerName": provider.get("name"),
        "templateId": template.get("id") if template else None,
        "templateName": template.get("name") if template else None,
        "languageProfileId": lp.get("id"),
        "languageProfileName": lp.get("name"),
        "formalityPolicy": run.get("formalityPolicy"),
        "register": policy.register,
        "samplingParams": {
            "temperature": sampling.get("temperature"),
            "top_p": sampling.get("top_p"),
            "max_tokens": sampling.get("max_tokens"),
            "seed": sampling.get("seed"),
            "turns": sampling.get("turns"),
            "relatedTopics": sampling.get("relatedTopics"),
            # Persist the per-run reasoning toggle so the conversation
            # drawer's Settings panel can show whether each assistant
            # turn was meant to capture reasoning content. Only present
            # on runs created after the toggle existed; older snapshots
            # leave it out and the drawer suppresses the row.
            "includeReasoning": sampling.get("includeReasoning"),
        },
        "toolIds": [t["id"] for t in tool_names],
        "toolNames": [t["name"] for t in tool_names],
        "toolsInvoked": tools_invoked or [],
        "taxonomyNodeId": (node or {}).get("id"),
        "taxonomyNodeName": (node or {}).get("name"),
        "taxonomyNodePath": (node or {}).get("path"),
        "personaId": (persona or {}).get("id"),
        "personaName": (persona or {}).get("name"),
        "difficulty": difficulty,
        "flowId": (flow or {}).get("id"),
        "flowName": (flow or {}).get("name"),
        "flowVersion": (flow or {}).get("version"),
    }


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def execute_job(job_id: str) -> str:
    """Run one generation job. Returns the conversation id created.

    Bookends the work with `job.invoked` / `job.end` events so the trace
    timeline always shows at least these two markers — even when something
    explodes before any other event gets written. The actual generation is
    in `_execute_job_inner`; transient upstream failures are handled by the
    per-turn retry inside that function (chat_completion_stream-wrapped).
    """
    await _log_event(job_id, "job.invoked", {"pid": __import__("os").getpid()})
    try:
        return await _execute_job_inner(job_id)
    finally:
        await _log_event(job_id, "job.end", {"pid": __import__("os").getpid()})


async def _execute_job_inner(job_id: str) -> str:
    job = await db.fetch_one(
        """
        SELECT id, "runId", "cellKey", "inputContext", status, attempts
        FROM "GenerationJob" WHERE id = $1
        """,
        job_id,
    )
    if not job:
        raise RuntimeError(f"job not found: {job_id}")

    run = await _load_run(job["runId"])
    grid = _as_dict(run.get("configSnapshot"))
    sampling = _as_dict(run.get("samplingParams"))

    # The cellKey + inputContext encode the (taxonomy, persona, difficulty, idx) tuple.
    ctx_blob = _as_dict(job.get("inputContext"))
    persona_id = ctx_blob.get("personaId")
    node_id = ctx_blob.get("taxonomyNodeId")
    # Optional — newer runs don't include it (difficulty was removed from the
    # wizard since it was effectively a noop unless the template referenced
    # `{{difficulty}}`). Older jobs still carry the field, so we keep reading.
    difficulty = ctx_blob.get("difficulty")

    await _log_event(
        job_id,
        "job.start",
        {"cellKey": job.get("cellKey"), "runId": run["id"], "inputContext": ctx_blob},
    )

    persona = await _load_persona(persona_id) if persona_id else None
    node = await _load_taxonomy_node(node_id) if node_id else None
    lp = await _load_language_profile(run["languageProfileId"])
    template = await _load_template(run["templateId"])
    provider = await _load_provider(run["providerCredentialId"])

    # The run's `includeReasoning` flag is the SINGLE SOURCE OF TRUTH for
    # whether assistant turns reason. We override the provider's
    # chat_template_kwargs in BOTH directions:
    #   includeReasoning=true  → enable_thinking=True  (force on, even if
    #                             provider default is off)
    #   includeReasoning=false → enable_thinking=False (force off, even if
    #                             provider default is on)
    # The old "fall through to provider default when the flag is absent"
    # behavior is the bug that left runs with empty assistant content:
    # a reasoning-enabled provider default + an unset flag burned the
    # entire max_tokens budget inside <think> with nothing emitted.
    _base_ctk = _as_dict(provider.get("chatTemplateKwargs")) or {}
    want_reasoning = bool(sampling.get("includeReasoning"))
    assistant_chat_template_kwargs: dict[str, Any] | None = {
        **_base_ctk,
        "enable_thinking": want_reasoning,
    }

    # User-simulator and helper LLM calls (opening user text, follow-up
    # user turns) must NEVER reason — those are synthetic user messages,
    # not assistant output. Force enable_thinking=False unconditionally
    # so a reasoning-default provider doesn't drain the budget on <think>
    # and leave us with empty content + the "Boleh terangkan lagi?" stub.
    simulator_chat_template_kwargs: dict[str, Any] | None = {
        **_base_ctk,
        "enable_thinking": False,
    }

    # Lightweight multi-topic: pick N additional sibling node names that the
    # template can weave into `{{taxonomy.related}}`. The conversation's primary
    # node FK doesn't change.
    related_count = int(sampling.get("relatedTopics", 0) or 0)
    related_names = (
        await _pick_related_nodes(run["projectId"], node_id, related_count)
        if related_count > 0
        else []
    )

    # Knowledge base: deterministic fetch by taxonomyNodeIds + project-wide
    # catch-alls. Becomes the {{knowledge}} template variable AND is appended
    # to the system prompt so the model sees it even if the template doesn't
    # reference {{knowledge}} explicitly.
    kb_entries = await _load_knowledge_entries(run["projectId"], node_id)
    knowledge_text = _format_knowledge_block(kb_entries)

    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = _as_dict(provider.get("headers"))

    await _log_event(
        job_id,
        "context.loaded",
        {
            "persona": _snapshot_persona(persona),
            "taxonomy": (
                {
                    "id": node.get("id") if node else None,
                    "name": node.get("name") if node else None,
                    "path": node.get("path") if node else None,
                    "related": related_names,
                }
                if node
                else None
            ),
            "languageProfile": {
                "id": lp.get("id"),
                "name": lp.get("name"),
                "primary": lp.get("primary"),
                "register": lp.get("register"),
                "allowParticles": lp.get("allowParticles"),
            },
            "template": {
                "id": template.get("id"),
                "name": template.get("name"),
                "kind": template.get("kind"),
            },
            "provider": {
                "kind": provider.get("kind"),
                "baseUrl": provider.get("baseUrl"),
                "defaultModel": provider.get("defaultModel"),
            },
            "model": run["model"],
            "relatedTopicsCount": related_count,
            "knowledgeBaseMatches": len(kb_entries),
        },
    )

    if kb_entries:
        await _log_event(
            job_id,
            "knowledge.loaded",
            {
                "count": len(kb_entries),
                "entries": [
                    {
                        "id": e["id"],
                        "title": e["title"],
                        "taxonomyNodeIds": list(e.get("taxonomyNodeIds") or []),
                        "tags": list(e.get("tags") or []),
                        "sourceUrl": e.get("sourceUrl"),
                        "contentChars": len(str(e.get("content") or "")),
                    }
                    for e in kb_entries
                ],
            },
        )

    # Build the formality-aware system prompt.
    policy = _resolve_formality(
        run_policy=run.get("formalityPolicy") or "inherit",
        persona=persona,
        lp=lp,
    )
    system_text = style_guide(policy)

    # ── Flow-driven dispatch ─────────────────────────────────────────────────
    # If the job was queued with a flowId in its inputContext, hand the rest of
    # the work off to flow_runner. It produces a multi-turn conversation that
    # walks the flow graph (invoking tools, following branches, etc.) instead
    # of the single-turn template render below.
    if ctx_blob.get("flowId"):
        if knowledge_text:
            system_text = (
                f"{system_text}\n\n{knowledge_text}" if system_text else knowledge_text
            )
        return await execute_flow_job(
            job_id=job_id,
            job=job,
            run=run,
            ctx_blob=ctx_blob,
            persona=persona,
            lp=lp,
            provider=provider,
            policy=policy,
            base_url=base_url,
            api_key=api_key,
            extra_headers=extra_headers,
            system_text=system_text,
            knowledge_text=knowledge_text,
            log_event=_log_event,
        )


    taxonomy_ctx: dict[str, Any] = dict(node or {})
    # Lightweight multi-topic: list of sibling node names available as
    # `{{taxonomy.related}}` (renders as comma-joined string).
    taxonomy_ctx["related"] = related_names

    rctx = RenderContext(
        persona=(persona or {}),
        taxonomy=taxonomy_ctx,
        language={
            "primary": lp.get("primary"),
            "script": lp.get("script"),
            "register": policy.register,
        },
        # `{{difficulty}}` falls back to empty string when the wizard didn't
        # supply one — keeps templates that reference it from showing literal
        # "None".
        difficulty=difficulty or "",
        knowledge=knowledge_text,
    )

    # If the template didn't opt into {{knowledge}} but we have KB entries, the
    # model would never see them. Always append to system_text so the entries
    # land in front of the model regardless of how the template is authored.
    if knowledge_text:
        system_text = (
            f"{system_text}\n\n{knowledge_text}" if system_text else knowledge_text
        )

    user_text = render(template["body"], rctx.to_dict())

    # ── Tool support ────────────────────────────────────────────────────────
    # Load every tool def the run made available. When the list is non-empty
    # we use the non-streaming path with `tools=…` so the model can actually
    # invoke them (chat_completion_stream doesn't support tools today). When
    # there are no tools, we keep the streaming nicety from slice 1.
    # Loaded BEFORE the messages array so the tool catalog can be described in
    # the system prompt — without that, models routinely refuse with "I don't
    # have access to that" even though `tools=…` is present in the request.
    from .flow_runner import (
        _load_tool_defs,
        _tools_payload,
        _mock_tool_result,
        _normalise_tool_calls,
    )

    grid_cfg = _as_dict(run.get("configSnapshot"))
    tool_ids = [t for t in (grid_cfg.get("toolIds") or []) if isinstance(t, str)]
    tool_defs = await _load_tool_defs(tool_ids) if tool_ids else []
    tools_payload = _tools_payload(tool_defs) if tool_defs else None
    tools_by_name = {t["name"]: t for t in tool_defs}

    # Replace the rendered template body with an LLM-generated opening user
    # message. The template body is treated as a SCENARIO HINT / instructions,
    # NOT as the literal first user turn — that way template bodies authored
    # in second-person "You are…" framing don't leak through as user content,
    # and each conversation gets a varied opening rooted in the same scenario.
    # When tools are configured we use the tool-aware variant so the opening
    # is engineered to trigger a tool call.
    sim_in0, sim_out0 = 0, 0
    sim_cost0 = 0.0
    if tool_defs:
        new_user_text, sim_in0, sim_out0, sim_cost0 = await _generate_tool_aware_user_text(
            fallback_text=user_text,
            persona=persona,
            lp=lp,
            policy=policy,
            tool_defs=tool_defs,
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            extra_headers=extra_headers,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=simulator_chat_template_kwargs,
            job_id=job_id,
            run_id=run["id"],
        )
        await _log_event(
            job_id,
            "user.tool_aware",
            {
                "fallback": user_text[:500],
                "generated": new_user_text[:500],
                "tokensIn": sim_in0,
                "tokensOut": sim_out0,
                "toolCount": len(tool_defs),
            },
        )
        user_text = new_user_text
    else:
        new_user_text, sim_in0, sim_out0, sim_cost0 = await _generate_seed_user_text(
            seed_text=user_text,
            persona=persona,
            lp=lp,
            policy=policy,
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            extra_headers=extra_headers,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=simulator_chat_template_kwargs,
            job_id=job_id,
            run_id=run["id"],
        )
        await _log_event(
            job_id,
            "user.seed",
            {
                "seed": user_text[:500],
                "generated": new_user_text[:500],
                "tokensIn": sim_in0,
                "tokensOut": sim_out0,
            },
        )
        user_text = new_user_text

    # Surface the tool catalog in the system prompt so the model knows it can
    # (and *should*) call them. Some models (Qwen3 included) won't pick tools
    # up from the API `tools=` array alone — they need a prose mention too.
    if tool_defs:
        tool_lines = ["## Available tools",
                      "You have these function-calling tools available — invoke them via "
                      "tool_calls (NOT plain text) whenever the user needs data lookup, "
                      "verification, or an action that one of them performs. Never claim "
                      "you lack access to something a listed tool provides."]
        for t in tool_defs:
            desc = (t.get("description") or "").strip().replace("\n", " ")
            tool_lines.append(f"- `{t['name']}` — {desc or '(no description)'}")
        tool_lines.append(
            "After a tool returns, integrate its result into a natural reply for the user."
        )
        tools_block = "\n".join(tool_lines)
        system_text = f"{system_text}\n\n{tools_block}" if system_text else tools_block

    messages: list[dict[str, Any]] = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.append({"role": "user", "content": user_text})

    await _log_event(
        job_id,
        "prompt.rendered",
        {
            "systemText": system_text or "",
            "userText": user_text,
            "formality": {
                "register": policy.register,
                "allowParticles": policy.allow_particles,
                "requireFormalMalay": policy.require_formal_malay,
            },
            "toolsAvailable": [t["name"] for t in tool_defs],
        },
    )

    started_marker = await db.execute(
        """
        UPDATE "GenerationJob"
        SET status = 'running', attempts = attempts + 1, "startedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1
        """,
        job_id,
    )

    async def _run_turn_with_tools(
        msgs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """One assistant turn that can invoke tools. Iterates up to 4 times:
        if the assistant emits tool_calls, we synthesize mock results via
        flow_runner._mock_tool_result, append assistant+tool messages, and ask
        for the follow-up. Returns the messages appended this turn plus tokens
        + the final content/latency.

        Uses chat_completion_stream (which now supports tools) so the Live job
        preview gets real token-level deltas instead of one-shot dumps. Each
        content/reasoning token + each tool_call name/arg fragment is forwarded
        as a pg_notify delta on the same channel the streaming first turn
        already uses.
        """
        async def _notify(text: str, reasoning: bool = False) -> None:
            if not text:
                return
            try:
                async with db.acquire() as ncon:
                    await ncon.execute(
                        "SELECT pg_notify('synthgen_job', $1)",
                        json.dumps({
                            "jobId": job_id,
                            "runId": run["id"],
                            "event": "delta",
                            "text": text,
                            "reasoning": reasoning,
                        }, ensure_ascii=False),
                    )
            except Exception:  # noqa: BLE001
                pass

        new_msgs: list[dict[str, Any]] = []
        t_in = 0
        t_out = 0
        t_cost = 0.0
        last_content = ""
        last_model = run["model"]
        last_latency = 0
        for turn_i in range(4):
            # Inner iterations only fire when the model emitted tool_calls and
            # we're feeding mock results back. Surface that explicitly via a
            # structured event so the client renders a divider, not inline text.
            if turn_i > 0:
                await _emit_event(job_id, run["id"], event="turn.followup")
            t_start = __import__("time").perf_counter()

            stream_content_parts: list[str] = []
            stream_reasoning_parts: list[str] = []
            stream_tokens_in = 0
            stream_tokens_out = 0
            stream_model = run["model"]
            stream_tool_calls: list[dict[str, Any]] | None = None
            # Track which (index, name) we've already announced so we only
            # emit one "[calling foo(…)]" marker per tool call.
            announced_tool_names: set[int] = set()

            stream_final_text: str = ""
            async for ev in chat_completion_stream(
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                messages=msgs + new_msgs,
                tools=tools_payload,
                temperature=float(sampling.get("temperature", 0.7)),
                top_p=float(sampling.get("top_p", 1.0)),
                max_tokens=sampling.get("max_tokens", 1024),
                seed=sampling.get("seed"),
                extra_headers=extra_headers,
                reasoning_effort=provider.get("reasoningEffort"),
                chat_template_kwargs=assistant_chat_template_kwargs,
            ):
                if ev.done:
                    stream_tokens_in = ev.tokens_in
                    stream_tokens_out = ev.tokens_out
                    stream_model = ev.model or run["model"]
                    stream_tool_calls = ev.tool_calls
                    # `ev.full_text` is the providers-layer cleaned content
                    # — with Mistral's `[TOOL_CALLS]name{args}` sentinel
                    # stripped after tool_calls were extracted client-side.
                    # Prefer it over the raw delta accumulator so the saved
                    # assistant message + the next turn's input don't carry
                    # the literal sentinel text.
                    stream_final_text = ev.full_text or ""
                    break
                if ev.delta:
                    if ev.reasoning:
                        stream_reasoning_parts.append(ev.delta)
                        await _notify(ev.delta, reasoning=True)
                    else:
                        stream_content_parts.append(ev.delta)
                        await _notify(ev.delta)
                if ev.tool_call_delta:
                    idx = int(ev.tool_call_delta.get("index", 0))
                    name = ev.tool_call_delta.get("name") or ""
                    frag = ev.tool_call_delta.get("argumentsFragment") or ""
                    await _emit_event(
                        job_id,
                        run["id"],
                        event="tool.call.frag",
                        index=idx,
                        name=name,
                        fragment=frag,
                    )
                    if name:
                        announced_tool_names.add(idx)

            t_in += stream_tokens_in
            t_out += stream_tokens_out
            t_cost += estimate_cost(stream_model, stream_tokens_in, stream_tokens_out)
            last_latency = int((__import__("time").perf_counter() - t_start) * 1000)
            last_model = stream_model
            tc = _normalise_tool_calls(stream_tool_calls) if stream_tool_calls else []
            # When the providers layer extracted tool_calls from an inline
            # sentinel (Mistral vLLM streaming), `stream_final_text` is the
            # cleaned content. Otherwise it equals the joined deltas.
            content = stream_final_text or "".join(stream_content_parts)

            # Catastrophic-empty detection: model returned HTTP 200 but
            # produced no content, no tool_calls, AND zero output tokens.
            # On flaky proxies this is common — we raise so the outer
            # caller can retry / surface a failure, instead of silently
            # persisting a blank assistant turn.
            if (
                not content
                and not tc
                and stream_tokens_out == 0
                and not "".join(stream_reasoning_parts)
            ):
                raise RuntimeError(
                    f"upstream returned empty completion "
                    f"(model={stream_model} tokens_in={stream_tokens_in} "
                    f"latency_ms={last_latency}) — likely a proxy/upstream "
                    f"hiccup, retry"
                )

            # Mark each streamed tool call as "args complete" so the client can
            # stop the inline "..." indicator and freeze the card.
            for idx in announced_tool_names:
                await _emit_event(
                    job_id, run["id"], event="tool.call.complete", index=idx,
                )

            asst_msg: dict[str, Any] = {"role": "assistant", "content": content}
            if tc:
                asst_msg["tool_calls"] = tc
            asst_msg["_tokens_out"] = stream_tokens_out
            asst_msg["_model"] = last_model
            asst_msg["_latency_ms"] = last_latency
            asst_msg["_reasoning_content"] = "".join(stream_reasoning_parts) or None
            new_msgs.append(asst_msg)
            last_content = content
            if not tc:
                break
            # Mock each tool's result and append as role:tool.
            for call in tc:
                fn = call.get("function") or {}
                tname = fn.get("name") or ""
                args_text = fn.get("arguments") or "{}"
                # No `[tool call: …]` echo here — the streaming
                # `tool_call_delta` loop above already announced this call as
                # the model emitted it. Duplicating it just clutters the UI.
                tdef = tools_by_name.get(tname)
                tool_reasoning_parts: list[str] = []
                if tdef is None:
                    tool_text = json.dumps(
                        {"error": f"unknown tool {tname!r}"}, ensure_ascii=False
                    )
                else:
                    await _emit_event(
                        job_id, run["id"], event="tool.mock.start", name=tname,
                    )
                    tool_text = await _mock_tool_result(
                        tool_def=tdef,
                        args_text=args_text,
                        base_url=base_url,
                        api_key=api_key,
                        model=run["model"],
                        extra_headers=extra_headers,
                        # Use the run's actual sampling params + reasoning
                        # controls so the mock backend has the same budget the
                        # assistant has (no more 600-token throttle that left
                        # reasoning models with empty `content`).
                        sampling_params=sampling,
                        reasoning_effort=provider.get("reasoningEffort"),
                        # Tool-result mock follows the run's
                        # includeReasoning toggle: when ON, the mock
                        # backend's chain-of-thought is captured (so the
                        # trace can show *why* the synthetic backend
                        # produced this payload); when OFF, thinking is
                        # forced off the same way the assistant turn is.
                        chat_template_kwargs=assistant_chat_template_kwargs,
                        # Forward each mock-backend delta (content + reasoning)
                        # to the live preview so the user sees the synthetic
                        # response materialize.
                        on_delta=_notify,
                        # Collect reasoning chunks so we can persist them
                        # on the role=tool Message row alongside content.
                        reasoning_sink=tool_reasoning_parts,
                    )
                preview = tool_text.replace("\n", " ")
                if len(preview) > 400:
                    preview = preview[:400] + "…"
                await _emit_event(
                    job_id, run["id"], event="tool.result", name=tname, preview=preview,
                )
                new_msgs.append({
                    "role": "tool",
                    "tool_call_id": call.get("id") or cuid_like(),
                    "name": tname,
                    "content": tool_text,
                    "_reasoning_content": "".join(tool_reasoning_parts) or None,
                })
        return {
            "messages": new_msgs,
            "tokens_in": t_in,
            "tokens_out": t_out,
            "cost_usd": t_cost,
            "content": last_content,
            "model": last_model,
            "latency_ms": last_latency,
        }

    # Stream the assistant response so the UI can show live tokens. We also
    # emit a pg_notify('synthgen_job', ...) per delta so the per-job SSE route
    # can forward to the browser. Reasoning deltas are forwarded with
    # reasoning=true; only content deltas accumulate into the final answer.
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    reasoning_started = False
    content_started = False
    tokens_in = 0
    tokens_out = 0
    upstream_model = run["model"]
    started = __import__("time").perf_counter()
    # Holds the assistant + tool messages produced by the FIRST turn when tools
    # are configured (streaming path can't carry tool_calls, so we use the
    # non-streaming helper).
    first_turn_extra_messages: list[dict[str, Any]] = []
    await _log_event(
        job_id,
        "provider.request",
        {
            "url": (provider.get("baseUrl") or "").rstrip("/") + "/chat/completions",
            "model": run["model"],
            "stream": True,
            "tools": [t["function"]["name"] for t in (tools_payload or [])],
            "samplingParams": {
                "temperature": sampling.get("temperature"),
                "top_p": sampling.get("top_p"),
                "max_tokens": sampling.get("max_tokens"),
                "seed": sampling.get("seed"),
            },
            "reasoningEffort": provider.get("reasoningEffort"),
            # Log the EFFECTIVE chat_template_kwargs (after the run's
            # `includeReasoning` override) — not just the provider's raw
            # config. Lets the trace UI show exactly what was sent.
            "chatTemplateKwargs": assistant_chat_template_kwargs,
        },
    )

    class _Result:
        pass
    result = _Result()
    result.content = ""
    result.reasoning_content = None
    result.tool_calls = None
    result.tokens_in = 0
    result.tokens_out = 0
    result.cost_usd = 0.0
    result.latency_ms = 0
    result.model = run["model"]
    result.raw = {"streamed": tools_payload is None, "model": run["model"]}

    if tools_payload is not None:
        # ── Tool-aware first turn (non-streaming) ────────────────────────────
        # Runs an assistant call with `tools=…`. The helper iterates internally
        # when the model emits tool_calls (synthesizes a mock result per call,
        # feeds it back, repeats — capped at 4 cycles). first_turn_extra_messages
        # carries everything past the FIRST assistant content turn (tool calls
        # + tool results + any follow-up assistant content).
        # Open the Live job preview SSE before the first model call so the UI
        # flips from "Connecting…" to "Streaming…" immediately. Also emit the
        # rendered seed user message as a structured turn.user event so the
        # client can render it as a "User · turn 1" card.
        await _emit_event(job_id, run["id"], event="start")
        await _emit_event(
            job_id, run["id"], event="turn.user", turn=1, text=user_text,
        )
        # Header for the assistant's first reply. Tool-less first turns get this
        # at line 1815 via the streaming branch; the tool-aware branch needs to
        # emit it explicitly because `_run_turn_with_tools` only knows about
        # *inner* tool/follow-up iterations and can't number the outer turn.
        await _emit_event(
            job_id, run["id"], event="turn.assistant", turn=1,
        )
        # Retry the first tool-mode turn up to 3 times — covers transient
        # proxy hiccups (0-token responses, mid-stream drops, 5xx) the
        # same way the multi-turn loop already does for turns 2..N.
        FIRST_TURN_RETRIES = 3
        first = None
        first_err: Exception | None = None
        for attempt in range(1, FIRST_TURN_RETRIES + 1):
            try:
                first = await _run_turn_with_tools(messages)
                first_err = None
                break
            except Exception as e:  # noqa: BLE001
                first_err = e
                log.warning(
                    "first tool-mode turn attempt %d/%d failed: %s",
                    attempt, FIRST_TURN_RETRIES, e,
                )
                await _log_event(
                    job_id,
                    "provider.empty_completion",
                    {
                        "attempt": attempt,
                        "of": FIRST_TURN_RETRIES,
                        "error": str(e)[:500],
                    },
                )
                if attempt < FIRST_TURN_RETRIES:
                    await asyncio.sleep(1.5 * attempt)
        if first is None:
            e = first_err or RuntimeError("first turn failed without error")
            log.exception("provider tool call failed for job=%s", job_id)
            await _log_event(job_id, "job.error", {"error": str(e)[:1000]})
            await db.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'failed', "lastError" = $2, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id, str(e)[:1000],
            )
            raise e

        first_msgs = first["messages"]
        first_assistant = next(
            (m for m in first_msgs if m.get("role") == "assistant"), None,
        )
        if first_assistant is not None:
            first_turn_extra_messages = [m for m in first_msgs if m is not first_assistant]
        else:
            first_turn_extra_messages = list(first_msgs)
        primary_content = (first_assistant or {}).get("content") or ""
        result.content = primary_content
        # Carry reasoning + tool_calls from the first tool-mode assistant
        # turn through to the persisted row. Previously these stayed at
        # their defaults (None) because the tool-mode branch only copied
        # `content`, so ordinal-2 assistant messages had blank reasoning
        # and a null `toolCalls` column even when the model produced both.
        result.reasoning_content = (first_assistant or {}).get(
            "_reasoning_content"
        )
        result.tool_calls = (first_assistant or {}).get("tool_calls")
        result.tokens_in = first["tokens_in"]
        result.tokens_out = int((first_assistant or {}).get("_tokens_out") or first["tokens_out"])
        result.cost_usd = first["cost_usd"]
        result.latency_ms = int((first_assistant or {}).get("_latency_ms") or first["latency_ms"])
        result.model = (first_assistant or {}).get("_model") or first["model"]
        tokens_in = result.tokens_in
        tokens_out = first["tokens_out"]
        upstream_model = result.model
    else:
        # ── Streaming first turn (no tools) ──────────────────────────────────
        await _emit_event(job_id, run["id"], event="start")
        await _emit_event(
            job_id, run["id"], event="turn.user", turn=1, text=user_text,
        )
        try:
            async for ev in chat_completion_stream(
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                messages=messages,
                temperature=float(sampling.get("temperature", 0.7)),
                max_tokens=sampling.get("max_tokens", 1024),
                extra_headers=extra_headers,
                reasoning_effort=provider.get("reasoningEffort"),
                chat_template_kwargs=assistant_chat_template_kwargs,
            ):
                if ev.done:
                    tokens_in = ev.tokens_in
                    tokens_out = ev.tokens_out
                    upstream_model = ev.model or run["model"]
                    break
                if ev.delta:
                    if ev.reasoning:
                        if not reasoning_started:
                            reasoning_started = True
                            await _log_event(job_id, "provider.stream.reasoning.start", {})
                        reasoning_parts.append(ev.delta)
                    else:
                        if not content_started:
                            content_started = True
                            await _log_event(
                                job_id,
                                "provider.stream.content.start",
                                {"afterReasoningChars": sum(len(x) for x in reasoning_parts)},
                            )
                        content_parts.append(ev.delta)
                    async with db.acquire() as ncon:
                        await ncon.execute(
                            "SELECT pg_notify('synthgen_job', $1)",
                            json.dumps({
                                "jobId": job_id,
                                "runId": run["id"],
                                "event": "delta",
                                "text": ev.delta,
                                "reasoning": ev.reasoning,
                            }),
                        )
        except Exception as e:  # noqa: BLE001
            log.exception("provider call failed for job=%s", job_id)
            await _log_event(job_id, "job.error", {"error": str(e)[:1000]})
            await db.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'failed', "lastError" = $2, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id, str(e)[:1000],
            )
            raise

        import time as _time
        elapsed_ms = int((_time.perf_counter() - started) * 1000)
        result.content = "".join(content_parts)
        result.reasoning_content = "".join(reasoning_parts) or None
        result.tokens_in = tokens_in
        result.tokens_out = tokens_out
        result.cost_usd = estimate_cost(upstream_model, tokens_in, tokens_out)
        result.latency_ms = elapsed_ms
        result.model = upstream_model
        result.raw = {"streamed": True, "model": upstream_model}

    # Use the latency the streaming branch tracked, OR result.latency_ms which
    # the tool-aware branch sets directly. Both should be populated by now.
    elapsed_ms = result.latency_ms

    await _log_event(
        job_id,
        "provider.response",
        {
            "model": upstream_model,
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": elapsed_ms,
            "contentChars": len(result.content),
            "reasoningChars": len(result.reasoning_content or ""),
        },
    )

    # NOTE: we DO NOT emit the SSE `done` event here yet — the multi-turn loop
    # below may produce more deltas, and the SSE route closes the stream as
    # soon as it sees `done`. Emit a `turn.end` instead so the listener stays
    # subscribed; the final `done` is sent after the loop completes.
    async with db.acquire() as ncon:
        await ncon.execute(
            "SELECT pg_notify('synthgen_job', $1)",
            json.dumps({
                "jobId": job_id,
                "runId": run["id"],
                "event": "turn.end",
                "turn": 1,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "latency_ms": elapsed_ms,
            }),
        )

    # Helper so the multi-turn loop can push deltas onto the same SSE channel,
    # mirroring the per-token deltas the streaming first turn already emits.
    async def _notify_delta(text: str, reasoning: bool = False) -> None:
        if not text:
            return
        try:
            async with db.acquire() as ncon:
                await ncon.execute(
                    "SELECT pg_notify('synthgen_job', $1)",
                    json.dumps({
                        "jobId": job_id,
                        "runId": run["id"],
                        "event": "delta",
                        "text": text,
                        "reasoning": reasoning,
                    }, ensure_ascii=False),
                )
        except Exception:  # noqa: BLE001
            pass

    # ── Multi-turn continuation ──────────────────────────────────────────────
    # `samplingParams.turns` is the user-requested number of user→assistant
    # exchanges. The first turn is already done above; loop turns 2..N. Each
    # iteration:
    #   1. Asks a user-simulator LLM (same provider/model, role-playing the
    #      persona) for the next user message. If it returns "[END]" we stop.
    #   2. Calls the assistant for the next reply (non-streamed — UI already
    #      committed the conversation start; further turns land on refresh).
    #
    # All extra messages collected here get persisted alongside the first turn.
    target_turns = max(1, int(sampling.get("turns", 1) or 1))
    await _log_event(
        job_id,
        "turn.plan",
        {
            "targetTurns": target_turns,
            "configuredTurns": sampling.get("turns"),
            "toolMode": tools_payload is not None,
        },
    )
    # `extra_messages` accumulates EVERY message past the first user+assistant
    # pair: tool calls/results synthesized during turn 1 plus all turns 2..N.
    extra_messages: list[dict[str, Any]] = list(first_turn_extra_messages)

    # Live transcript fed to both the user simulator and the next assistant call.
    # Includes the system prompt + first user + first assistant + any tool calls
    # and tool results synthesized during turn 1, so the simulator and the next
    # assistant turn both see real tool output.
    transcript: list[dict[str, Any]] = list(messages) + [
        {"role": "assistant", "content": result.content},
    ] + [
        # Strip our internal `_tokens_out` / `_model` / `_latency_ms` markers
        # before sending to the provider — those are persistence metadata only.
        {k: v for k, v in m.items() if not k.startswith("_")}
        for m in first_turn_extra_messages
    ]
    total_tokens_in = tokens_in
    total_tokens_out = tokens_out
    total_cost = result.cost_usd
    last_assistant_content = result.content
    last_assistant_model = result.model
    last_assistant_tokens_out = result.tokens_out
    last_assistant_latency = result.latency_ms

    for turn_i in range(2, target_turns + 1):
        user_text_next, sim_in, sim_out, sim_cost = await _simulate_user_turn(
            persona=persona,
            lp=lp,
            policy=policy,
            transcript=transcript,
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            extra_headers=extra_headers,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=simulator_chat_template_kwargs,
            max_tokens=int(sampling.get("max_tokens") or 1024),
            tool_defs=tool_defs if tool_defs else None,
            turn_number=turn_i,
            total_turns=target_turns,
            job_id=job_id,
            run_id=run["id"],
        )
        total_tokens_in += sim_in
        total_tokens_out += sim_out
        total_cost += sim_cost
        await _log_event(
            job_id,
            "turn.user.simulated",
            {"turn": turn_i, "text": user_text_next, "tokensIn": sim_in, "tokensOut": sim_out},
        )
        stripped = user_text_next.strip()
        # Defensive: if the model still emits the [END] sentinel despite the
        # prompt forbidding it inside the planned range, strip the marker and
        # keep whatever content follows so we don't lose the turn. Only break
        # if NOTHING usable remains.
        if stripped.startswith("[END]"):
            stripped = stripped[len("[END]"):].lstrip(" .,:;—-").strip()
            await _log_event(
                job_id,
                "turn.user.end_sentinel_stripped",
                {"turn": turn_i, "remaining_chars": len(stripped)},
            )
        if not stripped:
            # Simulator returned nothing usable (reasoning model burned its
            # budget on <think>, or template stripped the answer). Don't drop
            # the turn — sub in a neutral follow-up so the conversation keeps
            # its planned length. We log it so the trace shows the fallback.
            stripped = "Boleh terangkan lagi?"
            await _log_event(
                job_id,
                "turn.user.empty",
                {"turn": turn_i, "fallback": stripped},
            )
        user_text_next = stripped

        # Surface the simulated user turn as a structured event so the live
        # preview renders it as a "User · turn N" card, not inline text.
        await _emit_event(
            job_id, run["id"], event="turn.user", turn=turn_i, text=user_text_next,
        )

        extra_messages.append({"role": "user", "content": user_text_next})
        transcript.append({"role": "user", "content": user_text_next})

        # Each assistant turn gets up to MULTI_TURN_RETRIES attempts. A turn
        # that errors transiently (network blip, upstream 5xx, dropped stream)
        # used to silently `break` the loop and the job got marked succeeded
        # with only turn 1 persisted — that's the "1 turn only / tokensIn=83"
        # symptom. Now we retry with exponential backoff, and if we still
        # can't complete the turn we re-raise so the outer handler marks the
        # job failed (with lastError set) instead of pretending success.
        MULTI_TURN_RETRIES = 3
        last_err: Exception | None = None
        succeeded_this_turn = False
        for attempt in range(MULTI_TURN_RETRIES):
            try:
                if tools_payload is not None:
                    # Emit the "Assistant · turn N" divider before the model
                    # call so the live preview shows a header for this turn.
                    # Mirrors the tool-less branch below; gated on attempt==0
                    # to avoid duplicate dividers on retry.
                    if attempt == 0:
                        await _emit_event(
                            job_id, run["id"], event="turn.assistant", turn=turn_i,
                        )
                    next_first = await _run_turn_with_tools(transcript)
                    turn_msgs = next_first["messages"]
                    turn_tokens_in = next_first["tokens_in"]
                    turn_tokens_out = next_first["tokens_out"]
                    turn_cost = next_first["cost_usd"]
                    turn_latency = next_first["latency_ms"]
                    # Append every assistant/tool message to extra_messages + transcript.
                    for m in turn_msgs:
                        extra_messages.append(m)
                        transcript.append({k: v for k, v in m.items() if not k.startswith("_")})
                    final_assistant = next(
                        (m for m in reversed(turn_msgs) if m.get("role") == "assistant"),
                        None,
                    )
                    if final_assistant is not None:
                        last_assistant_content = final_assistant.get("content") or ""
                        last_assistant_model = final_assistant.get("_model") or run["model"]
                        last_assistant_tokens_out = int(final_assistant.get("_tokens_out") or 0)
                        last_assistant_latency = int(final_assistant.get("_latency_ms") or turn_latency)
                    total_tokens_in += turn_tokens_in
                    total_tokens_out += turn_tokens_out
                    total_cost += turn_cost
                    await _log_event(
                        job_id,
                        "turn.assistant",
                        {
                            "turn": turn_i,
                            "model": last_assistant_model,
                            "tokensIn": turn_tokens_in,
                            "tokensOut": turn_tokens_out,
                            "latencyMs": turn_latency,
                            "contentChars": len(last_assistant_content),
                            "withTools": True,
                            "attempt": attempt + 1,
                        },
                    )
                    succeeded_this_turn = True
                    break

                # Tool-less path: stream the response so the live preview gets
                # token-by-token deltas, matching the turn-1 streaming experience.
                t_start = __import__("time").perf_counter()
                stream_content_parts = []
                stream_reasoning_parts = []
                stream_tokens_in = 0
                stream_tokens_out = 0
                stream_model = run["model"]

                # Structured event so the client renders this as an "Assistant ·
                # turn N" divider rather than inline text. Only emit on the first
                # attempt; on retry we keep the same banner so the UI doesn't show
                # duplicate dividers.
                if attempt == 0:
                    await _emit_event(
                        job_id, run["id"], event="turn.assistant", turn=turn_i,
                    )

                async for ev in chat_completion_stream(
                    base_url=base_url,
                    api_key=api_key,
                    model=run["model"],
                    messages=transcript,
                    temperature=float(sampling.get("temperature", 0.7)),
                    max_tokens=sampling.get("max_tokens", 1024),
                    extra_headers=extra_headers,
                    reasoning_effort=provider.get("reasoningEffort"),
                    chat_template_kwargs=assistant_chat_template_kwargs,
                ):
                    if ev.done:
                        stream_tokens_in = ev.tokens_in
                        stream_tokens_out = ev.tokens_out
                        stream_model = ev.model or run["model"]
                        break
                    if ev.delta:
                        if ev.reasoning:
                            stream_reasoning_parts.append(ev.delta)
                        else:
                            stream_content_parts.append(ev.delta)
                        await _notify_delta(ev.delta, reasoning=ev.reasoning)
                turn_latency = int((__import__("time").perf_counter() - t_start) * 1000)

                # An "empty" success (no content + no usage) is treated as a
                # failure so the retry kicks in — otherwise we'd persist an
                # empty assistant message and continue.
                if not stream_content_parts and stream_tokens_out == 0:
                    raise RuntimeError(
                        f"turn {turn_i}: provider returned no content and no usage",
                    )
                succeeded_this_turn = True
                last_err = None
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                log.warning(
                    "turn %s attempt %s/%s failed: %s",
                    turn_i, attempt + 1, MULTI_TURN_RETRIES, e,
                )
                await _log_event(
                    job_id,
                    "turn.retry",
                    {"turn": turn_i, "attempt": attempt + 1, "error": str(e)[:500]},
                )
                if attempt + 1 < MULTI_TURN_RETRIES:
                    await asyncio.sleep(min(2 ** attempt, 8))

        if not succeeded_this_turn:
            # All retries exhausted. Re-raise so the outer wrapper marks the
            # job failed with lastError set — much better UX than the old
            # silent `break` that left jobs as "succeeded with only 1 turn".
            err_msg = (
                f"turn {turn_i} failed after {MULTI_TURN_RETRIES} attempts: "
                f"{last_err}"
            )
            await _log_event(job_id, "turn.error", {"turn": turn_i, "error": err_msg[:1000]})
            raise last_err or RuntimeError(err_msg)

        if tools_payload is not None:
            # Tool-aware branch already appended messages + logged the event.
            # Skip the tool-less bookkeeping below.
            continue

        # Materialize the streamed turn into the same shape the non-stream
        # branch produced so the downstream code reads identically.
        total_tokens_in += stream_tokens_in
        total_tokens_out += stream_tokens_out
        total_cost += estimate_cost(stream_model, stream_tokens_in, stream_tokens_out)
        last_assistant_content = "".join(stream_content_parts)
        last_assistant_model = stream_model
        last_assistant_tokens_out = stream_tokens_out
        last_assistant_latency = turn_latency

        extra_messages.append({
            "role": "assistant",
            "content": last_assistant_content,
            "_tokens_out": stream_tokens_out,
            "_model": last_assistant_model,
            "_latency_ms": turn_latency,
            "_reasoning_content": "".join(stream_reasoning_parts) or None,
        })
        transcript.append({"role": "assistant", "content": last_assistant_content})

        await _log_event(
            job_id,
            "turn.assistant",
            {
                "turn": turn_i,
                "model": last_assistant_model,
                "tokensIn": stream_tokens_in,
                "tokensOut": stream_tokens_out,
                "latencyMs": turn_latency,
                "contentChars": len(last_assistant_content),
                "reasoningChars": sum(len(p) for p in stream_reasoning_parts),
                "withTools": False,
            },
        )

    actual_user_turns = 1 + sum(1 for m in extra_messages if m.get("role") == "user")
    # Defensive assertion. With the per-turn retry above, the loop either
    # produces a turn or raises — there's no path that silently drops one,
    # so this should be unreachable. If it ever fires, something we haven't
    # accounted for is breaking the loop and we want it loud.
    if actual_user_turns < target_turns:
        await _log_event(
            job_id,
            "turn.shortfall",
            {"actualTurns": actual_user_turns, "targetTurns": target_turns},
        )
        raise RuntimeError(
            f"BUG: multi-turn loop produced {actual_user_turns} of "
            f"{target_turns} turns without raising — investigate"
        )

    # Multi-turn loop is done — close the SSE stream with a final `done` event
    # carrying the rolled-up token counters across every turn.
    async with db.acquire() as ncon:
        await ncon.execute(
            "SELECT pg_notify('synthgen_job', $1)",
            json.dumps({
                "jobId": job_id,
                "runId": run["id"],
                "event": "done",
                "tokens_in": total_tokens_in,
                "tokens_out": total_tokens_out,
                "latency_ms": last_assistant_latency,
            }),
        )
    # Used by validators + persistence below. We deliberately validate the LAST
    # assistant turn (most reflective of how the conversation finishes); per-turn
    # validation can land later if needed.
    final_assistant_content = last_assistant_content

    # Validate the assistant content.
    vctx = ValidatorContext(
        primary_language=lp.get("primary") or "ms",
        script=lp.get("script") or "latin",
        register=policy.register,
        allow_particles=policy.allow_particles,
        banned_tokens=list(lp.get("bannedTokens") or []),
        banned_patterns=list(lp.get("bannedPatterns") or []),
        require_formal_malay=policy.require_formal_malay,
        english_loanword_policy=policy.english_loanword_policy,
        loanword_allowlist=policy.loanword_allowlist,
        code_switch_policy=lp.get("codeSwitchPolicy") or "none",
        code_switch_rate=lp.get("codeSwitchRate"),
    )
    verdicts = run_pipeline(final_assistant_content, vctx)
    for v in verdicts:
        await _log_event(
            job_id,
            "validator.run",
            {
                "validatorKind": v.validator_kind,
                "axis": v.axis,
                "verdict": v.verdict,
                "score": v.score,
                "details": v.details,
            },
        )
    has_fail = any(v.verdict == "fail" for v in verdicts)
    primary_lang = vctx.detected_language or vctx.primary_language

    conv_id = cuid_like()
    sys_msg_id = cuid_like()
    user_msg_id = cuid_like()
    asst_msg_id = cuid_like()

    settings_snapshot = await _settings_snapshot(
        run=run,
        persona=persona,
        node=node,
        lp=lp,
        template=template,
        provider=provider,
        policy=policy,
        sampling=sampling,
        difficulty=difficulty,
        mode="single-turn",
    )

    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO "Conversation" (
                    id, "projectId", "runId", "taxonomyNodeId", "personaId",
                    "primaryLanguage", "primaryScript", difficulty, "turnCount",
                    "tokenCount", status, "dedupHash", "settingsSnapshot",
                    "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13::jsonb,
                    NOW(), NOW()
                )
                """,
                conv_id,
                run["projectId"],
                run["id"],
                node_id,
                persona_id,
                primary_lang,
                lp.get("script") or "latin",
                difficulty,
                actual_user_turns,
                total_tokens_in + total_tokens_out,
                "rejected" if has_fail else "accepted",
                _content_hash(final_assistant_content),
                # Pass the dict directly (NOT json.dumps): asyncpg's jsonb
                # codec encodes on the way out; pre-stringifying causes
                # double-encoding and the column ends up as a JSON-string.
                settings_snapshot,
            )

            ordinal = 0
            if system_text:
                await conn.execute(
                    """INSERT INTO "Message"
                       (id, "conversationId", ordinal, role, content, "createdAt")
                       VALUES ($1, $2, $3, 'system', $4, NOW())""",
                    sys_msg_id, conv_id, ordinal, system_text,
                )
                ordinal += 1
            await conn.execute(
                """INSERT INTO "Message"
                   (id, "conversationId", ordinal, role, content, "createdAt")
                   VALUES ($1, $2, $3, 'user', $4, NOW())""",
                user_msg_id, conv_id, ordinal, user_text,
            )
            ordinal += 1
            await conn.execute(
                """INSERT INTO "Message"
                   (id, "conversationId", ordinal, role, content, "reasoningContent",
                    "toolCalls",
                    language, script, "tokenCount", "latencyMs", model,
                    "rawProviderResponse", "createdAt")
                   VALUES ($1, $2, $3, 'assistant', $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, NOW())""",
                asst_msg_id, conv_id, ordinal, result.content,
                result.reasoning_content,
                # Pass the Python list directly so the jsonb codec encodes
                # it once — see the same caveat on the multi-turn assistant
                # insert below.
                getattr(result, "tool_calls", None) or None,
                primary_lang, lp.get("script") or "latin",
                result.tokens_out, result.latency_ms, result.model,
                json.dumps(result.raw),
            )
            ordinal += 1

            # Persist any extra messages: tool calls / tool results from the
            # first turn plus all turns 2..N (user simulation, assistant, and
            # any nested tool-call loops).
            for m in extra_messages:
                role = m.get("role")
                content = m.get("content") or ""
                if role == "user":
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content, "createdAt")
                           VALUES ($1, $2, $3, 'user', $4, NOW())""",
                        cuid_like(), conv_id, ordinal, content,
                    )
                elif role == "assistant":
                    # IMPORTANT: pass the Python list directly — db.py registers
                    # an asyncpg jsonb codec with `encoder=json.dumps`, so
                    # pre-stringifying causes a DOUBLE json.dumps (the column
                    # ends up storing `"[{…}]"` — a JSON string of a JSON
                    # string — instead of `[{…}]`).
                    tool_calls_obj = m.get("tool_calls") or None
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content,
                            "reasoningContent", "toolCalls",
                            language, script, "tokenCount", "latencyMs", model, "createdAt")
                           VALUES ($1, $2, $3, 'assistant', $4, $5, $6::jsonb, $7, $8, $9, $10, $11, NOW())""",
                        cuid_like(),
                        conv_id,
                        ordinal,
                        content,
                        m.get("_reasoning_content"),
                        tool_calls_obj,
                        primary_lang,
                        lp.get("script") or "latin",
                        int(m.get("_tokens_out") or 0),
                        int(m.get("_latency_ms") or 0),
                        m.get("_model") or run["model"],
                    )
                elif role == "tool":
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content,
                            "reasoningContent", "toolCallId", "createdAt")
                           VALUES ($1, $2, $3, 'tool', $4, $5, $6, NOW())""",
                        cuid_like(),
                        conv_id,
                        ordinal,
                        content,
                        m.get("_reasoning_content"),
                        m.get("tool_call_id"),
                    )
                ordinal += 1

            for v in verdicts:
                await conn.execute(
                    """INSERT INTO "Validation"
                       (id, "conversationId", "validatorKind", axis, verdict, score,
                        details, "createdAt")
                       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())""",
                    cuid_like(), conv_id, v.validator_kind, v.axis, v.verdict, v.score,
                    json.dumps(v.details) if v.details else None,
                )

            await conn.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'succeeded', "conversationId" = $2,
                    "tokensIn" = $3, "tokensOut" = $4, "costUsd" = $5,
                    "latencyMs" = $6, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id, conv_id,
                total_tokens_in, total_tokens_out, total_cost, last_assistant_latency,
            )

            await conn.execute(
                """
                UPDATE "GenerationRun"
                SET "producedCount" = "producedCount" + 1,
                    "acceptedCount" = "acceptedCount" + $2,
                    "tokensIn" = "tokensIn" + $3,
                    "tokensOut" = "tokensOut" + $4,
                    "costUsd" = COALESCE("costUsd", 0) + $5,
                    "updatedAt" = NOW()
                WHERE id = $1
                """,
                run["id"],
                0 if has_fail else 1,
                total_tokens_in,
                total_tokens_out,
                total_cost,
            )

            # Postgres NOTIFY so SSE listeners on the Next.js side wake up.
            await conn.execute(
                "SELECT pg_notify('synthgen_run', $1)",
                json.dumps({"runId": run["id"], "event": "job.done", "jobId": job_id}),
            )

    await _log_event(
        job_id,
        "conversation.persisted",
        {
            "conversationId": conv_id,
            "status": "rejected" if has_fail else "accepted",
            "primaryLanguage": primary_lang,
            "turnCount": actual_user_turns,
            "tokenCount": (total_tokens_in or 0) + (total_tokens_out or 0),
        },
    )

    return conv_id
