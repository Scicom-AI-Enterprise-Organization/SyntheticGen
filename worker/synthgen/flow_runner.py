"""Flow-driven multi-turn generation.

Drives the LLM through a Flow graph: walks start → intent → action → … → end,
asking the model to invoke each action's tools and following condition branches.
Produces a multi-turn conversation that actually exercises the flow (every
intent becomes a user turn, every action either produces an assistant content
turn or one or more tool calls + synthetic tool results, every condition picks
an outgoing edge, every end produces a closing assistant turn).

The Slice-1 pipeline in `generation.py` is kept as-is for non-flow jobs; the
top-level `execute_job` dispatches here when `inputContext.flowId` is set.
"""
from __future__ import annotations

import json
import logging
import random
import re
import time
from typing import Any, Awaitable, Callable

from . import db
from .ids import cuid_like
from .providers import chat_completion, chat_completion_stream, estimate_cost
from .validators import ValidatorContext, run_pipeline


log = logging.getLogger(__name__)


# ───── data loading ─────────────────────────────────────────────────────────

def _as_dict(v: Any) -> dict[str, Any]:
    if v is None:
        return {}
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return dict(v)


async def _load_flow(flow_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """
        SELECT id, "projectId", name, description, version, nodes, edges, "isPublished"
        FROM "Flow" WHERE id = $1
        """,
        flow_id,
    )
    if not row:
        return None
    out = dict(row)
    out["nodes"] = _parse_json_list(out.get("nodes"))
    out["edges"] = _parse_json_list(out.get("edges"))
    return out


def _parse_json_list(v: Any) -> list[dict[str, Any]]:
    if v is None:
        return []
    if isinstance(v, list):
        return [x for x in v if isinstance(x, dict)]
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
        except json.JSONDecodeError:
            return []
        return [x for x in parsed if isinstance(x, dict)] if isinstance(parsed, list) else []
    return []


async def _load_tool_defs(tool_ids: list[str]) -> list[dict[str, Any]]:
    """Load ToolDef rows by id OR name.

    The flow editor stores `toolIds` as tool NAMES on action nodes
    (e.g. "banking_customer_inquiry_lookup"), not as DB ids. So we
    accept both — querying with `id = ANY(...) OR name = ANY(...)`.
    Without the OR-on-name fallback, every flow action's `tools_for_call`
    came back empty and the model never got a tool catalog to invoke,
    which is why "Lookup Customer Inquiry" produced plain text instead
    of calling `banking_customer_inquiry_lookup`.
    """
    if not tool_ids:
        return []
    rows = await db.fetch_all(
        """
        SELECT id, name, description, parameters, "mockSeed", "mockResponseSchema", examples
        FROM "ToolDef"
        WHERE id = ANY($1::text[]) OR name = ANY($1::text[])
        """,
        tool_ids,
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        rec = dict(r)
        rec["parameters"] = _as_dict(rec.get("parameters")) or {"type": "object", "properties": {}}
        rec["mockSeed"] = _as_dict(rec.get("mockSeed")) if rec.get("mockSeed") else None
        rec["mockResponseSchema"] = (
            _as_dict(rec.get("mockResponseSchema")) if rec.get("mockResponseSchema") else None
        )
        ex = rec.get("examples")
        if isinstance(ex, str):
            try:
                rec["examples"] = json.loads(ex)
            except json.JSONDecodeError:
                rec["examples"] = []
        elif not isinstance(ex, list):
            rec["examples"] = []
        out.append(rec)
    return out


def _tools_payload(tool_defs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """OpenAI `tools` array shape."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description") or "",
                "parameters": t.get("parameters") or {"type": "object", "properties": {}},
            },
        }
        for t in tool_defs
    ]


# ───── flow graph helpers ───────────────────────────────────────────────────

def _build_adjacency(
    edges: list[dict[str, Any]],
) -> dict[str, list[tuple[str, str | None]]]:
    """source-id → list of (target-id, label)."""
    adj: dict[str, list[tuple[str, str | None]]] = {}
    for e in edges:
        src = e.get("source")
        tgt = e.get("target")
        if not isinstance(src, str) or not isinstance(tgt, str):
            continue
        label = e.get("label") if isinstance(e.get("label"), str) else None
        adj.setdefault(src, []).append((tgt, label))
    return adj


def _node_by_id(nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for n in nodes:
        nid = n.get("id")
        if isinstance(nid, str):
            out[nid] = n
    return out


def _find_start(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
    for n in nodes:
        if n.get("type") == "start":
            return n
    return nodes[0] if nodes else None


# ───── intent → user utterance ───────────────────────────────────────────────

async def _stream_helper_text(
    *,
    sys: str,
    user: str,
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    temperature: float,
    max_tokens: int,
    job_id: str | None,
    run_id: str | None,
    node_id: str | None,
) -> tuple[str, int, int]:
    """Common pattern for the start/intent/bridge helpers: stream a small
    LLM call and emit `flow.delta` (reasoning + content) tagged with
    `node_id` so the live preview surfaces the model's thinking inside
    the matching flow_node card instead of leaving it on `running…`.

    Returns (final_content, tokens_in, tokens_out)."""
    content_parts: list[str] = []
    tokens_in = 0
    tokens_out = 0
    async for ev in chat_completion_stream(
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        extra_headers=extra_headers,
    ):
        if ev.done:
            tokens_in = ev.tokens_in
            tokens_out = ev.tokens_out
            break
        if ev.delta:
            if not ev.reasoning:
                content_parts.append(ev.delta)
            if job_id and run_id and node_id:
                await _emit_event(
                    job_id, run_id,
                    event="flow.delta",
                    node=node_id,
                    reasoning=bool(ev.reasoning),
                    text=ev.delta,
                )
    return "".join(content_parts).strip().strip('"').strip("'"), tokens_in, tokens_out


async def _start_to_user_greeting(
    *,
    start_data: dict[str, Any],
    persona_ctx: dict[str, Any],
    lang_ctx: dict[str, Any],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
) -> str:
    """Generate the FIRST user-side greeting for the flow.

    Was a no-op (the start node just transitioned), which left the saved
    conversation starting with the intent paraphrase as the only user turn.
    Now produces a short, persona-aware "hello, I need help with…" so the
    transcript opens like a real customer conversation. Falls back to a
    deterministic greeting on any LLM failure.
    """
    label = start_data.get("label") or "Greeting"
    sys = (
        "Produce ONE short user-side opening greeting (1-2 sentences) the "
        "customer would type to start a support conversation. Respond in the "
        "target language and register, in character for the persona. Don't "
        "state the full problem yet — just a hello + brief intent like 'I "
        "need help with my account'. Return ONLY the utterance — no preamble, "
        "no quotes, no role tag, no markdown."
    )
    user = (
        f"Start-node label: {label}\n"
        f"Persona: {json.dumps(persona_ctx, ensure_ascii=False)}\n"
        f"Language: {lang_ctx.get('primary')} ({lang_ctx.get('register')})\n"
    )
    try:
        text, _, _ = await _stream_helper_text(
            sys=sys, user=user,
            base_url=base_url, api_key=api_key, model=model,
            extra_headers=extra_headers,
            temperature=0.8, max_tokens=2048,
            job_id=job_id, run_id=run_id, node_id=node_id,
        )
        if text:
            return text
    except Exception as e:  # noqa: BLE001
        log.warning("start greeting generation failed: %s", e)
    # Deterministic fallback so the saved conversation always opens with
    # SOMETHING customer-shaped.
    lang = (lang_ctx.get("primary") or "ms").lower()
    if lang.startswith("ms"):
        return "Selamat sejahtera, saya perlukan bantuan."
    return "Hello, I need some help, please."


async def _simulate_user_follow_up(
    *,
    persona_ctx: dict[str, Any],
    lang_ctx: dict[str, Any],
    messages: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
) -> str:
    """Generate a single in-character user reply continuing the conversation.

    Used to bridge two consecutive action nodes that would otherwise produce
    back-to-back assistant turns. The resulting message is PERSISTED to
    `messages`, so the saved transcript reads as a natural user → assistant
    → user → assistant alternation rather than several assistant messages
    glued together with an internal nudge.
    """
    transcript_tail = _short_transcript(messages, max_chars=2000)
    sys = (
        "You are role-playing the USER side of a customer-support conversation. "
        "Given the persona and the recent transcript, write ONE short user "
        "reply (1-2 sentences) that continues the conversation naturally — "
        "ask a follow-up, provide a detail the assistant requested, or push "
        "for the next step. Stay in character + in the target language. "
        "Return ONLY the user's utterance — no preamble, no quotes, no role "
        "tag, no markdown, no [END] sentinel."
    )
    user = (
        f"Persona: {json.dumps(persona_ctx, ensure_ascii=False)}\n"
        f"Language: {lang_ctx.get('primary')} ({lang_ctx.get('register')})\n\n"
        f"Recent transcript:\n{transcript_tail}\n\n"
        "Write the user's next reply now."
    )
    try:
        text, _, _ = await _stream_helper_text(
            sys=sys, user=user,
            base_url=base_url, api_key=api_key, model=model,
            extra_headers=extra_headers,
            temperature=0.8, max_tokens=2048,
            job_id=job_id, run_id=run_id, node_id=node_id,
        )
        if text:
            return text
    except Exception as e:  # noqa: BLE001
        log.warning("user follow-up generation failed: %s", e)
    # Mild fallback — better than a hard "(Please proceed...)" string in
    # the dataset, but still flags itself as a fallback for reviewers.
    lang = (lang_ctx.get("primary") or "ms").lower()
    if lang.startswith("ms"):
        return "Boleh teruskan?"
    return "Could you continue?"


async def _generate_assistant_ack(
    *,
    persona_ctx: dict[str, Any],
    lang_ctx: dict[str, Any],
    messages: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
) -> str:
    """Generate a brief assistant acknowledgment used to bridge two
    consecutive user messages (e.g. start_greet's hello → intent_node's
    actual request). Keeps the saved transcript alternating."""
    transcript_tail = _short_transcript(messages, max_chars=1500)
    sys = (
        "You are a customer-support assistant. Produce ONE short reply "
        "(1-2 sentences) that politely acknowledges the customer's greeting "
        "and invites them to share their question. Respond in the target "
        "language and register. Return ONLY the reply — no preamble, no "
        "quotes, no markdown."
    )
    user = (
        f"Persona of the customer: {json.dumps(persona_ctx, ensure_ascii=False)}\n"
        f"Language: {lang_ctx.get('primary')} ({lang_ctx.get('register')})\n\n"
        f"Recent transcript:\n{transcript_tail}\n\nWrite the assistant's reply now."
    )
    try:
        text, _, _ = await _stream_helper_text(
            sys=sys, user=user,
            base_url=base_url, api_key=api_key, model=model,
            extra_headers=extra_headers,
            temperature=0.5, max_tokens=2048,
            job_id=job_id, run_id=run_id, node_id=node_id,
        )
        if text:
            return text
    except Exception as e:  # noqa: BLE001
        log.warning("assistant ack generation failed: %s", e)
    lang = (lang_ctx.get("primary") or "ms").lower()
    if lang.startswith("ms"):
        return "Selamat sejahtera. Bagaimana saya boleh bantu anda hari ini?"
    return "Hello, how can I help you today?"


async def _intent_to_user_text(
    *,
    intent_data: dict[str, Any],
    persona_ctx: dict[str, Any],
    lang_ctx: dict[str, Any],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    rng: random.Random,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
) -> str:
    """Produce ONE short user-side utterance that expresses this intent
    in character. Always routes through the LLM so the live preview can
    stream reasoning + content into the intent flow_node card. Any
    `examples` from the flow are used as SEED material the model riffs
    on — not as a verbatim shortcut — so two cells with the same flow
    don't produce the same exact opening user message and the live
    preview always shows the model thinking.
    """
    label = intent_data.get("label") or "user intent"
    description = intent_data.get("description") or ""
    examples = intent_data.get("examples") or []
    examples_block = ""
    if isinstance(examples, list) and examples:
        # Show all examples to the model so it can riff on tone/length,
        # and pick one as the primary seed to anchor the variation.
        sampled = [e for e in examples if isinstance(e, str) and e.strip()]
        if sampled:
            seed = rng.choice(sampled)
            examples_block = (
                f"Reference examples (DON'T copy verbatim — riff in your own words):\n"
                + "\n".join(f"- {e}" for e in sampled)
                + f"\n\nUse this one as the primary seed for tone + length:\n  → {seed}\n\n"
            )
    sys = (
        "Produce ONE short user-side utterance (1-2 sentences) that expresses "
        "the intent below. Respond in the target language and register, in "
        "character for the given persona. If reference examples are provided, "
        "vary the wording naturally rather than echoing them verbatim.\n\n"
        "If the intent involves looking up records, transactions, accounts, "
        "or contacting a service that would need identifying information, "
        "INCLUDE realistic Malaysian identifiers naturally in the utterance "
        "— e.g. a MyKad number in `XXXXXX-XX-XXXX` format that matches a "
        "plausible birthdate, a 10-16 digit account number, a `+60` mobile, "
        "or a ticket reference like `TCKT-2024XXXXXX`. Real customers "
        "volunteer this info when asking for help; doing the same here "
        "lets downstream tools call with valid arguments instead of "
        "placeholder text.\n\n"
        "Return ONLY the utterance — no preamble, no quotes, no role tag."
    )
    user = (
        f"Intent label: {label}\n"
        f"Intent description: {description}\n"
        f"Persona: {json.dumps(persona_ctx, ensure_ascii=False)}\n"
        f"Language: {lang_ctx.get('primary')} ({lang_ctx.get('register')})\n\n"
        f"{examples_block}"
    )
    try:
        text, _, _ = await _stream_helper_text(
            sys=sys, user=user,
            base_url=base_url, api_key=api_key, model=model,
            extra_headers=extra_headers,
            temperature=0.7, max_tokens=2048,
            job_id=job_id, run_id=run_id, node_id=node_id,
        )
        if text:
            return text
        # Reasoning blew the whole token budget on <think>: content came
        # back empty. Don't fall back to the literal node-label like
        # "Identify Customer Intent" — that's developer-facing wording a
        # real customer would never say. Prefer a seed example verbatim
        # if any, else a generic in-language opener so the dataset stays
        # realistic.
        if examples:
            sampled = [e for e in examples if isinstance(e, str) and e.strip()]
            if sampled:
                return rng.choice(sampled)
        lang = (lang_ctx.get("primary") or "ms").lower()
        if lang.startswith("ms"):
            return "Saya ada satu hal yang ingin saya tanya."
        return "I have a question I'd like help with."
    except Exception as e:  # noqa: BLE001
        log.warning("intent paraphrase failed: %s", e)
        if examples:
            sampled = [e for e in examples if isinstance(e, str) and e.strip()]
            if sampled:
                return rng.choice(sampled)
        return label


# ───── action node: tool-call loop + tool result synthesis ───────────────────

_TOOL_CALL_LIMIT = 6


async def _mock_tool_result(
    *,
    tool_def: dict[str, Any],
    args_text: str,
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    sampling_params: dict[str, Any] | None = None,
    reasoning_effort: str | None = None,
    chat_template_kwargs: dict[str, Any] | None = None,
    on_delta: Callable[..., Awaitable[None]] | None = None,
) -> str:
    """Synthesize a realistic tool response. Order of preference:
        1. tool.mockSeed (deterministic).
        2. tool.mockResponseSchema (LLM fills in JSON conforming to schema).
        3. Fallback: ask the LLM to invent a plausible response given the tool
           description and args.
        4. Final fallback: stub `{"status": "ok", ...}` keyed by tool name + args.
    Returns a JSON string suitable for use as a tool message `content`.

    `sampling_params`, `reasoning_effort`, and `chat_template_kwargs` are passed
    through verbatim from the calling run — same temperature, max_tokens, seed,
    and reasoning controls the assistant uses. That way a Qwen3-thinking run
    with max_tokens=21248 doesn't get throttled to 600 here.

    When `on_delta` is provided we stream the underlying LLM call and forward
    each content / reasoning fragment via the callback (signature: same as
    generation._notify — `(text, reasoning=bool)`). That way the Live job
    preview can show the synthetic backend's reasoning + JSON materializing.
    """
    if tool_def.get("mockSeed"):
        try:
            return json.dumps(tool_def["mockSeed"], ensure_ascii=False)
        except Exception:  # noqa: BLE001
            pass

    sp = sampling_params or {}
    schema = tool_def.get("mockResponseSchema")
    sys = (
        "You are a mock backend for a tool/function. Given the tool name, "
        "description, response schema (if any), and the caller's arguments, "
        "produce ONE plausible JSON response object. Return ONLY the JSON "
        "object — no surrounding text, no markdown fences."
    )
    user = (
        f"Tool: {tool_def.get('name')}\n"
        f"Description: {tool_def.get('description') or ''}\n"
        f"Caller arguments (JSON): {args_text}\n"
        + (f"Response schema (JSON Schema): {json.dumps(schema, ensure_ascii=False)}\n" if schema else "")
        + "Make the response Malaysia-locale-appropriate when relevant. Always "
        + "include realistic-looking values for any keys you invent — never "
        + "return an empty object."
    )
    try:
        if on_delta is not None:
            # Stream + collect so the user sees the synthetic backend "think"
            # in the Live job preview. Same loop the assistant uses.
            content_parts: list[str] = []
            async for ev in chat_completion_stream(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
                temperature=float(sp.get("temperature", 0.3)),
                top_p=float(sp.get("top_p", 1.0)),
                max_tokens=int(sp.get("max_tokens") or 4000),
                seed=sp.get("seed"),
                extra_headers=extra_headers,
                reasoning_effort=reasoning_effort,
                chat_template_kwargs=chat_template_kwargs,
            ):
                if ev.done:
                    break
                if ev.delta:
                    if not ev.reasoning:
                        content_parts.append(ev.delta)
                    await on_delta(ev.delta, reasoning=ev.reasoning)
            text = "".join(content_parts).strip()
        else:
            r = await chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
                temperature=float(sp.get("temperature", 0.3)),
                top_p=float(sp.get("top_p", 1.0)),
                max_tokens=int(sp.get("max_tokens") or 4000),
                seed=sp.get("seed"),
                extra_headers=extra_headers,
                reasoning_effort=reasoning_effort,
                chat_template_kwargs=chat_template_kwargs,
            )
            text = (r.content or "").strip()
        # Strip code fences if present.
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        if text:
            try:
                json.loads(text)
                return text
            except Exception:  # noqa: BLE001
                # Try to extract the first balanced {...} from prose.
                first = text.find("{")
                last = text.rfind("}")
                if first >= 0 and last > first:
                    candidate = text[first : last + 1]
                    try:
                        json.loads(candidate)
                        return candidate
                    except Exception:  # noqa: BLE001
                        pass
                return json.dumps({"raw": text}, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        log.warning("mock tool result failed for %s: %s", tool_def.get("name"), e)

    # Final fallback: synthesize a plausible-looking stub from the tool's
    # mockResponseSchema (when present) OR a generic ok payload echoing the
    # arguments. Better than `{"raw": ""}` which makes the assistant refuse.
    log.warning(
        "mock tool result empty for %s — falling back to schema-derived stub",
        tool_def.get("name"),
    )
    try:
        args = json.loads(args_text) if isinstance(args_text, str) else (args_text or {})
    except Exception:  # noqa: BLE001
        args = {}
    return json.dumps(
        _synthesize_stub_response(tool_def, args),
        ensure_ascii=False,
    )


def _synthesize_stub_response(
    tool_def: dict[str, Any], args: dict[str, Any]
) -> dict[str, Any]:
    """Build a deterministic stub response from the tool's mockResponseSchema
    properties (filling with type-appropriate placeholders) OR — when there's
    no schema — a generic `{status: ok, ...}` that echoes the call args. The
    goal is to keep the conversation flowing rather than handing the assistant
    an empty blob it will refuse to act on."""
    schema = tool_def.get("mockResponseSchema") or {}
    out: dict[str, Any] = {
        "status": "ok",
        "tool": tool_def.get("name"),
        "request": args,
    }
    props = schema.get("properties") if isinstance(schema, dict) else None
    if isinstance(props, dict):
        for name, pschema in props.items():
            if name in out or not isinstance(pschema, dict):
                continue
            ptype = pschema.get("type")
            if isinstance(pschema.get("enum"), list) and pschema["enum"]:
                out[name] = pschema["enum"][0]
            elif ptype == "string":
                out[name] = pschema.get("description") or "ok"
            elif ptype in ("number", "integer"):
                out[name] = pschema.get("minimum") if isinstance(pschema.get("minimum"), (int, float)) else 0
            elif ptype == "boolean":
                out[name] = True
            elif ptype == "array":
                out[name] = []
            elif ptype == "object":
                out[name] = {}
    return out


async def _run_action(
    *,
    action_data: dict[str, Any],
    node_id: str,
    tool_defs_by_id: dict[str, dict[str, Any]],
    messages: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Run one action node. Returns a dict with the new messages appended (also
    mutates `messages` in-place) and aggregated token/cost counters."""
    tool_ids = action_data.get("toolIds") if isinstance(action_data.get("toolIds"), list) else []
    tools_for_call = [tool_defs_by_id[i] for i in tool_ids if i in tool_defs_by_id]
    tools_payload = _tools_payload(tools_for_call) if tools_for_call else None

    # The outer flow loop guarantees the tail of `messages` isn't an
    # assistant turn before this action runs — it bridges with a real
    # synthesized user follow-up turn when the prior action left an
    # assistant message at the end. So we can send `messages` directly
    # to chat_completion_stream without an in-call nudge, and the saved
    # conversation alternates user → assistant → user → assistant
    # naturally.
    tokens_in = 0
    tokens_out = 0
    cost_usd = 0.0

    # The model can chain tool calls; cap at _TOOL_CALL_LIMIT.
    # Track the final model/latency so the return value is accurate even if
    # the last call streamed (we no longer get a single result object back).
    upstream_model = model
    last_latency_ms = 0
    for iter_i in range(_TOOL_CALL_LIMIT):
        call_messages = messages

        # Action nodes with toolIds expect the model to actually invoke
        # the configured tool — without forcing tool_choice, reasoning
        # models routinely answer in plain text and the flow ends with
        # zero `role: "tool"` rows in the saved dataset. So on the FIRST
        # iteration we pin tool_choice to:
        #   - the single tool's name when exactly one is configured (the
        #     common case for flow action nodes — each step has one tool)
        #   - "required" when multiple are configured (let the model
        #     decide which, but it MUST pick one)
        # Subsequent iterations fall back to "auto" so the model can
        # either chain another tool call or wrap up with content.
        tool_choice: Any = None
        if tools_payload and iter_i == 0:
            if len(tools_payload) == 1:
                forced_name = tools_payload[0]["function"]["name"]
                tool_choice = {"type": "function", "function": {"name": forced_name}}
            else:
                tool_choice = "required"

        # Stream the call so the live preview can render content + reasoning
        # tokens as they arrive (same UX the non-flow path already gets).
        # Per-delta `flow.delta` events are tagged with the node_id so the
        # UI knows which flow node the text belongs to.
        stream_content: list[str] = []
        stream_reasoning: list[str] = []
        stream_tool_calls = None
        stream_tokens_in = 0
        stream_tokens_out = 0
        stream_full_text = ""
        t_start = time.perf_counter()
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=call_messages,
            tools=tools_payload,
            tool_choice=tool_choice,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_headers=extra_headers,
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=chat_template_kwargs,
        ):
            if ev.done:
                stream_tokens_in = ev.tokens_in
                stream_tokens_out = ev.tokens_out
                stream_tool_calls = ev.tool_calls
                stream_full_text = ev.full_text or ""
                if ev.model:
                    upstream_model = ev.model
                break
            if ev.delta and job_id and run_id:
                if ev.reasoning:
                    stream_reasoning.append(ev.delta)
                else:
                    stream_content.append(ev.delta)
                await _emit_event(
                    job_id, run_id,
                    event="flow.delta",
                    node=node_id,
                    reasoning=bool(ev.reasoning),
                    text=ev.delta,
                )
            elif ev.delta:
                if ev.reasoning:
                    stream_reasoning.append(ev.delta)
                else:
                    stream_content.append(ev.delta)
            if ev.tool_call_delta and job_id and run_id:
                tcd = ev.tool_call_delta
                await _emit_event(
                    job_id, run_id,
                    event="flow.tool_call.frag",
                    node=node_id,
                    index=int(tcd.get("index", 0)),
                    name=tcd.get("name") or "",
                    fragment=tcd.get("argumentsFragment") or "",
                )
        last_latency_ms = int((time.perf_counter() - t_start) * 1000)
        tokens_in += stream_tokens_in
        tokens_out += stream_tokens_out
        cost_usd += estimate_cost(upstream_model, stream_tokens_in, stream_tokens_out)

        tool_calls = stream_tool_calls or []
        # Prefer the providers-layer cleaned full_text (sentinel stripped
        # for Mistral inline tool_calls). Falls back to joined deltas.
        content = stream_full_text or "".join(stream_content)

        if tool_calls:
            assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": _normalise_tool_calls(tool_calls),
            }
            messages.append(assistant_msg)

            # Synthesize a result for each tool call in order. Pass an
            # on_delta callback to stream the synthetic backend's response
            # (Qwen's "thinking" + JSON) into the live preview.
            for tc in assistant_msg["tool_calls"]:
                fn = tc.get("function") or {}
                tool_name = fn.get("name")
                args_text = fn.get("arguments") or "{}"
                tool_def = next(
                    (t for t in tools_for_call if t.get("name") == tool_name), None
                )
                if job_id and run_id:
                    await _emit_event(
                        job_id, run_id,
                        event="flow.tool.mock.start",
                        node=node_id,
                        name=tool_name,
                        argsPreview=args_text[:300],
                    )
                if tool_def is None:
                    tool_result = json.dumps(
                        {"error": f"unknown tool {tool_name!r}"}, ensure_ascii=False
                    )
                else:
                    async def _tool_delta(text: str, reasoning: bool = False, _node=node_id, _name=tool_name) -> None:
                        if not (job_id and run_id):
                            return
                        await _emit_event(
                            job_id, run_id,
                            event="flow.tool.mock.delta",
                            node=_node,
                            tool=_name,
                            reasoning=bool(reasoning),
                            text=text,
                        )
                    tool_result = await _mock_tool_result(
                        tool_def=tool_def,
                        args_text=args_text,
                        base_url=base_url,
                        api_key=api_key,
                        model=model,
                        extra_headers=extra_headers,
                        sampling_params={
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                        },
                        reasoning_effort=reasoning_effort,
                        chat_template_kwargs=chat_template_kwargs,
                        on_delta=_tool_delta if (job_id and run_id) else None,
                    )
                if job_id and run_id:
                    preview = tool_result.replace("\n", " ")
                    if len(preview) > 400:
                        preview = preview[:400] + "…"
                    await _emit_event(
                        job_id, run_id,
                        event="flow.tool.result",
                        node=node_id,
                        name=tool_name,
                        preview=preview,
                    )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id") or cuid_like(),
                    "name": tool_name,
                    "content": tool_result,
                })
            # Loop again — let the model react to the tool results.
            continue

        # No tool calls — model produced a final assistant content turn.
        messages.append({"role": "assistant", "content": content})
        return {
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "model": upstream_model,
            "latency_ms": last_latency_ms,
            "final_content": content,
        }

    # Tool-call cap exceeded — append a stub assistant content so the turn closes.
    stub = (
        "(tool-call loop exceeded; stopping to keep the conversation finite)"
    )
    messages.append({"role": "assistant", "content": stub})
    return {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": cost_usd,
        "model": model,
        "latency_ms": 0,
        "final_content": stub,
    }


def _sanitize_tool_args(args: str) -> str:
    """Best-effort cleanup of a tool_call.arguments JSON string.

    Reasoning models forced to invoke a tool (tool_choice="required" /
    function-pinned) sometimes emit invalid JSON — e.g. unclosed strings
    followed by streams of raw \\t / \\n characters. When we echo that
    assistant message back on the next iteration, vLLM tries to re-parse
    the arguments field and 400s with "Invalid control character".

    Strategy:
      1. If args parses cleanly → re-serialize via json.dumps so the
         output is canonical / control-char-safe.
      2. If not, escape raw control chars (0x00–0x1F except already-
         escaped ones) and try again.
      3. If still broken → fall back to "{}" so the next iteration's
         conversation history stays valid JSON; the model will react
         to the empty-args call shape.
    """
    if not isinstance(args, str) or not args:
        return "{}"
    try:
        parsed = json.loads(args)
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed, ensure_ascii=False)
        return "{}"
    except (json.JSONDecodeError, ValueError):
        pass
    # Replace raw control chars inside what should be JSON strings.
    # `ensure_ascii=False` keeps Unicode readable; control chars get
    # mapped to their \uXXXX form which IS valid JSON inside a string.
    cleaned_chars: list[str] = []
    for ch in args:
        cp = ord(ch)
        if cp < 0x20 and ch not in "\n\r":
            # Map raw control chars to a space so the JSON parser doesn't
            # choke. We can't preserve them as \uXXXX from outside string
            # context, so a space is the safest cross-context replacement.
            cleaned_chars.append(" ")
        else:
            cleaned_chars.append(ch)
    cleaned = "".join(cleaned_chars)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed, ensure_ascii=False)
    except (json.JSONDecodeError, ValueError):
        pass
    log.warning(
        "tool_call.arguments failed to parse even after sanitization; falling back to {}. raw=%r",
        args[:200],
    )
    return "{}"


def _normalise_tool_calls(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for tc in raw:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
        name = fn.get("name") if isinstance(fn, dict) else None
        args = fn.get("arguments") if isinstance(fn, dict) else tc.get("arguments")
        if isinstance(args, (dict, list)):
            args_str = json.dumps(args, ensure_ascii=False)
        elif args is None:
            args_str = "{}"
        elif isinstance(args, str):
            args_str = _sanitize_tool_args(args)
        else:
            args_str = "{}"
        if name:
            out.append({
                "id": tc.get("id") or cuid_like(),
                "type": "function",
                "function": {"name": name, "arguments": args_str},
            })
    return out


# ───── condition node: pick an outgoing edge ─────────────────────────────────

async def _pick_condition_branch(
    *,
    condition_data: dict[str, Any],
    candidates: list[tuple[str, str | None]],
    messages: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
    attempt: int = 1,
    max_attempts: int | None = None,
) -> int:
    """Return the index into `candidates` of the chosen outgoing edge.
    Falls back to 0 (first edge) on any failure."""
    if not candidates:
        return 0
    if len(candidates) == 1:
        return 0

    label = condition_data.get("label") or "branch"
    expression = condition_data.get("expression") or ""
    options_lines = []
    fallback_indices: list[int] = []  # "unknown"/"default"/"other" options
    for i, (_tgt, lbl) in enumerate(candidates):
        lbl_str = (lbl or "(no label)")
        options_lines.append(f"{i}: {lbl_str}")
        if isinstance(lbl, str) and lbl.lower() in {
            "unknown", "default", "other", "none", "fallback", "escalated",
        }:
            fallback_indices.append(i)
    options_text = "\n".join(options_lines)

    # Extract the LATEST tool result so the picker can route on it
    # explicitly — without this, the picker only saw a 2000-char
    # truncated transcript that often clipped the relevant JSON and
    # the model defaulted to the "unknown" / fallback branch even
    # when the tool result clearly mapped to a real branch.
    last_tool_result_excerpt = ""
    for m in reversed(messages):
        if m.get("role") == "tool":
            content = (m.get("content") or "")
            last_tool_result_excerpt = content[:1500]
            break
    transcript_tail = _short_transcript(messages, max_chars=2500)

    fallback_hint = (
        f"\n\nIMPORTANT: option(s) {fallback_indices} are fallback / "
        f"\"unknown\" branches. Pick a fallback ONLY when no other option "
        f"genuinely fits the data. If the tool result or transcript hints "
        f"at ANY non-fallback option, choose THAT — flows that always end "
        f"on the fallback branch are useless for the dataset."
        if fallback_indices else ""
    )

    sys = (
        "You are a flow router. Read the conversation + the latest tool "
        "result, then choose which outgoing edge to follow. Tool results "
        "often contain fields that map directly to one of the option "
        "labels (e.g. inquiry_type, status, category). Map them. Pick "
        "the most specific option that fits. Reasoning is fine, but your "
        "FINAL line must be ONLY a single integer — the chosen option "
        "index. No surrounding text on the final line." + fallback_hint
    )
    attempt_block = ""
    if max_attempts:
        attempt_block = (
            f"\nLoop attempt: this condition has been visited "
            f"{attempt} time(s) so far, out of a configured maximum of "
            f"{max_attempts}. If retrying would push attempts beyond "
            f"the maximum, prefer an `exhausted` / `failed` / "
            f"`escalated` branch when available.\n"
        )
    user = (
        f"Condition: {label}\n"
        f"Expression: {expression}\n"
        f"{attempt_block}\n"
        f"Options:\n{options_text}\n\n"
        + (
            f"Most recent tool result (use this to pick):\n```\n{last_tool_result_excerpt}\n```\n\n"
            if last_tool_result_excerpt else ""
        )
        + f"Recent transcript:\n{transcript_tail}\n\n"
        "Final answer (integer only):"
    )
    try:
        # max_tokens needs to be large enough for reasoning models (Qwen3
        # thinking, Mistral with --reasoning-parser) to finish their
        # <think> block AND emit the integer answer. The old budget of 8
        # was content-only sizing — reasoning models burned all of it on
        # thinking, returned empty content, and we fell back to 0 (the
        # first edge label, usually "billing"), making every flow look
        # like it always routes to billing. 2048 gives reasoning room
        # plus the trailing integer for both Qwen3 thinking and Mistral.
        # We DON'T set chat_template_kwargs here — vLLM's Mistral
        # tokenizer mode rejects any chat_template_kwargs field with
        # "chat_template is not supported for Mistral tokenizers", and
        # this picker is provider-agnostic.
        #
        # We stream the call so the picker's reasoning + final integer
        # show up live inside the condition node's flow_node card, so
        # the user can see WHY a particular branch was chosen.
        content_parts: list[str] = []
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.0,
            max_tokens=2048,
            extra_headers=extra_headers,
        ):
            if ev.done:
                break
            if ev.delta and job_id and run_id and node_id:
                if not ev.reasoning:
                    content_parts.append(ev.delta)
                await _emit_event(
                    job_id, run_id,
                    event="flow.delta",
                    node=node_id,
                    reasoning=bool(ev.reasoning),
                    text=ev.delta,
                )
            elif ev.delta and not ev.reasoning:
                content_parts.append(ev.delta)
        raw = "".join(content_parts).strip()
        # Extract the LAST integer in the content rather than the first.
        # The model's prose / reasoning before the final answer routinely
        # mentions earlier option indices ("option 0 maps to billing
        # but..."); first-integer extraction grabbed those mentions and
        # routed wrong. The prompt explicitly says the FINAL line is
        # the integer answer, so the last digit-run in the content is
        # what we want.
        all_ints = re.findall(r"\d+", raw)
        if all_ints:
            i = int(all_ints[-1])
            if 0 <= i < len(candidates):
                return i
    except Exception as e:  # noqa: BLE001
        log.warning("condition branch pick failed: %s", e)
    # Last-resort fallback: if the model is hard-stuck and we have any
    # non-fallback candidates, prefer the first non-fallback over edge 0.
    # Without this, picker failures + fallback-first edge ordering would
    # always route to the "unknown" branch.
    for i, (_tgt, lbl) in enumerate(candidates):
        if i in fallback_indices:
            continue
        return i
    return 0


def _short_transcript(messages: list[dict[str, Any]], max_chars: int = 2000) -> str:
    out: list[str] = []
    for m in messages[-12:]:
        role = (m.get("role") or "?").upper()
        content = m.get("content") or ""
        if m.get("tool_calls"):
            try:
                content = (content + "\n  tool_calls: " + json.dumps(m["tool_calls"], ensure_ascii=False))[:600]
            except Exception:  # noqa: BLE001
                pass
        out.append(f"[{role}] {content[:500]}")
    blob = "\n".join(out)
    return blob[-max_chars:] if len(blob) > max_chars else blob


# ───── end node: closing assistant turn ──────────────────────────────────────

async def _produce_closing(
    *,
    end_data: dict[str, Any],
    messages: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    job_id: str | None = None,
    run_id: str | None = None,
    node_id: str | None = None,
) -> dict[str, Any]:
    label = end_data.get("label") or "End"
    outcome = end_data.get("outcome") or "resolved"
    sys = (
        "Produce ONE short closing assistant turn (1-3 sentences) that wraps up "
        "the conversation in character, matching the outcome label. Return ONLY "
        "the closing text — no role tag, no markdown."
    )
    user = (
        f"Closing label: {label}\n"
        f"Outcome: {outcome}\n\n"
        f"Recent transcript:\n{_short_transcript(messages)}"
    )
    # Stream so the closing assistant turn materializes inside the end
    # node's flow_node card in the live preview. Reasoning models need
    # the larger budget to finish <think> AND emit the closing text.
    try:
        content_parts: list[str] = []
        tokens_in = 0
        tokens_out = 0
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=2048,
            extra_headers=extra_headers,
        ):
            if ev.done:
                tokens_in = ev.tokens_in
                tokens_out = ev.tokens_out
                break
            if ev.delta and job_id and run_id and node_id:
                if not ev.reasoning:
                    content_parts.append(ev.delta)
                await _emit_event(
                    job_id, run_id,
                    event="flow.delta",
                    node=node_id,
                    reasoning=bool(ev.reasoning),
                    text=ev.delta,
                )
            elif ev.delta and not ev.reasoning:
                content_parts.append(ev.delta)
        text = "".join(content_parts).strip()
        return {
            "content": text or label,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": estimate_cost(model, tokens_in, tokens_out),
        }
    except Exception as e:  # noqa: BLE001
        log.warning("closing turn failed: %s", e)
        return {"content": label, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}


# ───── live SSE event emitter ───────────────────────────────────────────────

async def _emit_event(job_id: str, run_id: str, **payload: Any) -> None:
    """Emit a structured pg_notify event on the synthgen_job channel — same
    shape as generation._emit_event so the live preview's SSE pipeline picks
    it up without changes. Best-effort; never throws."""
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


# ───── main entrypoint ──────────────────────────────────────────────────────

_MAX_STEPS = 60  # safety cap on TOTAL node visits to avoid pathological cycles
_MAX_VISITS_PER_NODE = 12  # per-node guard for ambient loops without maxAttempts


async def execute_flow_job(
    *,
    job_id: str,
    job: dict[str, Any],
    run: dict[str, Any],
    ctx_blob: dict[str, Any],
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
    provider: dict[str, Any],
    policy,
    base_url: str,
    api_key: str,
    extra_headers: dict[str, Any] | None,
    system_text: str,
    knowledge_text: str,
    log_event,
) -> str:
    """Run one flow-driven job. `log_event` is the same `_log_event` helper from
    generation.py — passed in to keep this module independent of generation's
    private symbols.

    Returns the new conversation id.
    """
    flow_id = ctx_blob.get("flowId")
    difficulty = ctx_blob.get("difficulty") or "medium"
    sampling = _as_dict(run.get("samplingParams"))
    temperature = float(sampling.get("temperature", 0.7))
    max_tokens = int(sampling.get("max_tokens", 1024))
    seed = sampling.get("seed")
    rng = random.Random(seed) if isinstance(seed, int) else random.Random()

    flow = await _load_flow(flow_id) if isinstance(flow_id, str) else None
    if flow is None:
        raise RuntimeError(f"flow not found: {flow_id}")

    config = _as_dict(run.get("configSnapshot"))
    chat_template_kwargs = _as_dict(provider.get("chatTemplateKwargs")) or None
    reasoning_effort = provider.get("reasoningEffort")

    # Load every tool referenced anywhere in the flow's action nodes (plus
    # run-level toolIds as a safety net).
    referenced_tool_ids: set[str] = set()
    for n in flow["nodes"]:
        if n.get("type") == "action":
            for tid in (n.get("data") or {}).get("toolIds") or []:
                if isinstance(tid, str):
                    referenced_tool_ids.add(tid)
    for tid in config.get("toolIds") or []:
        if isinstance(tid, str):
            referenced_tool_ids.add(tid)
    tool_defs = await _load_tool_defs(sorted(referenced_tool_ids))
    # Index by both id AND name. Flow editor stores names on action
    # nodes; some callers / legacy data might use ids. Looking up by
    # both means the runner finds the def either way.
    tool_defs_by_id: dict[str, dict[str, Any]] = {}
    for t in tool_defs:
        if isinstance(t.get("id"), str):
            tool_defs_by_id[t["id"]] = t
        if isinstance(t.get("name"), str):
            tool_defs_by_id[t["name"]] = t

    # Build a compact graph view (just the fields the UI needs: id, type,
    # label, position for layout, source/target for edges). Persisted to
    # JobEvent AND pushed via SSE so the live preview can render the DAG
    # immediately AND a refresh-after-done can replay the same view.
    compact_nodes = [
        {
            "id": n.get("id"),
            "type": n.get("type"),
            "label": (n.get("data") or {}).get("label"),
            "description": (n.get("data") or {}).get("description"),
            "position": n.get("position"),
            "outcome": (n.get("data") or {}).get("outcome"),
        }
        for n in flow["nodes"]
    ]
    compact_edges = [
        {
            "id": e.get("id"),
            "source": e.get("source"),
            "target": e.get("target"),
            "label": e.get("label"),
        }
        for e in flow["edges"]
    ]

    await log_event(
        job_id,
        "flow.loaded",
        {
            "flowId": flow["id"],
            "name": flow.get("name"),
            "version": flow.get("version"),
            "nodeCount": len(flow["nodes"]),
            "edgeCount": len(flow["edges"]),
            "toolCount": len(tool_defs),
            "graph": {"nodes": compact_nodes, "edges": compact_edges},
        },
    )

    try:
        await _emit_event(
            job_id, run["id"],
            event="flow.graph",
            flowId=flow["id"],
            name=flow.get("name"),
            nodes=compact_nodes,
            edges=compact_edges,
        )
    except Exception:  # noqa: BLE001
        pass

    nodes = flow["nodes"]
    edges = flow["edges"]
    by_id = _node_by_id(nodes)
    adj = _build_adjacency(edges)
    start = _find_start(nodes)
    if start is None:
        raise RuntimeError("flow has no nodes")

    # Persona / language context for intent paraphrase.
    persona_ctx = {
        "name": (persona or {}).get("name"),
        "region": (persona or {}).get("region"),
        "urbanity": (persona or {}).get("urbanity"),
        "formality": (persona or {}).get("formality"),
        "dialectTags": (persona or {}).get("dialectTags") or [],
    }
    lang_ctx = {
        "primary": lp.get("primary"),
        "script": lp.get("script"),
        "register": policy.register,
    }

    # Flow-execution conduct that goes on top of the run's normal system
    # prompt. Two failure modes this addresses:
    #   1. Forced tool_choice + a user message that lacks the required
    #      argument (e.g. "My card was declined" with no MyKad) used to
    #      produce placeholder args like "need to ask" — the mock backend
    #      then fabricated unrelated customer data, and the saved tool
    #      call was useless for training data.
    #   2. After getting a tool result, the assistant routinely asked the
    #      user AGAIN for info the tool result already contained, making
    #      the saved conversation incoherent.
    flow_conduct = (
        "Flow execution rules (override your normal behaviour):\n"
        "- When you invoke a tool, fill EVERY required argument with a "
        "realistic Malaysian value inferred from the conversation context "
        "and the customer's persona (e.g. a MyKad in `^[0-9]{6}-[0-9]{2}-"
        "[0-9]{4}$` format that matches a plausible birthdate, a 10-16 "
        "digit account number, or a `+60[0-9]{9,10}` mobile). DO NOT use "
        "placeholder strings like \"need to ask\", \"unknown\", \"pending\", "
        "\"placeholder\", \"...\", or any other non-realistic marker. If "
        "the user hasn't stated a value, INVENT a plausible one rather "
        "than emitting placeholder text.\n"
        "- After a tool returns a result, that result is GROUND TRUTH for "
        "the rest of this conversation. USE it in your next reply: "
        "address the customer by the name returned, reference the specific "
        "values from the response (account number, status, balance, "
        "ticket / reference id, dates). DO NOT ask the customer for "
        "information that the tool already returned. If the tool's data "
        "answers the customer's question, ANSWER from that data; don't "
        "deflect or ask for more info.\n"
        "- Closing turns must reflect what ACTUALLY happened in this "
        "conversation. If a tool reported the issue is `IN_PROGRESS` or "
        "`PENDING`, do NOT claim it is resolved; say it's being processed "
        "and give the realistic ETA from the tool result."
    )
    composed_system = (
        f"{system_text}\n\n{flow_conduct}" if system_text else flow_conduct
    )
    messages: list[dict[str, Any]] = []
    messages.append({"role": "system", "content": composed_system})

    # Walk the graph.
    started = time.perf_counter()
    total_tokens_in = 0
    total_tokens_out = 0
    total_cost = 0.0
    upstream_model = run["model"]
    user_turn_count = 0
    visited_actions = 0
    # Per-node visit counter. Used to implement loops with bounded
    # retries: a condition node with `data.maxAttempts: N` automatically
    # forces an `exhausted` (or equivalent) branch once it's been visited
    # N times, regardless of what the LLM picker chose. Lets flow authors
    # write "try IC verification 3 times, then escalate" without hand-
    # writing the counter logic into the expression.
    visit_counts: dict[str, int] = {}

    # Helper that fires both the JobEvent log (for replay) AND the SSE
    # `flow.step` (so the live preview can flip the node card from
    # `running…` to done). The OLD code only logged — there was no SSE
    # event ever, so every flow_node card stuck on "running..." until
    # the page refreshed.
    async def emit_flow_step(payload: dict[str, Any]) -> None:
        await log_event(job_id, "flow.step", payload)
        await _emit_event(job_id, run["id"], event="flow.step", **payload)

    # Bridges that keep the saved conversation alternating user → assistant.
    # Defined as locals so they can be called from the main loop right BEFORE
    # `flow.node.start` fires — otherwise the synthesized user follow-up
    # ends up rendering AFTER the next flow_node card in the live preview.
    # Bridges get their own synthetic flow_node cards so the live preview
    # can stream the model's reasoning + content live inside a regular
    # flow_node block (with kind="bridge_assistant" or "bridge_user").
    # Without this the bridge card would sit on `running…` for tens of
    # seconds while the reasoning model thinks, with nothing visible.
    bridge_counter = {"n": 0}

    async def bridge_user_to_assistant(before_node: str) -> None:
        bridge_counter["n"] += 1
        pseudo_id = f"__bridge_assistant_{bridge_counter['n']}__"
        # Open a pseudo-node card so the streaming reasoning + content
        # has somewhere to render.
        await _emit_event(
            job_id, run["id"],
            event="flow.node.start",
            node=pseudo_id,
            kind="bridge_assistant",
            label="Acknowledgement",
        )
        ack = await _generate_assistant_ack(
            persona_ctx=persona_ctx, lang_ctx=lang_ctx, messages=messages,
            base_url=base_url, api_key=api_key, model=run["model"],
            extra_headers=extra_headers,
            job_id=job_id, run_id=run["id"], node_id=pseudo_id,
        )
        messages.append({"role": "assistant", "content": ack})
        await _emit_event(
            job_id, run["id"],
            event="flow.step",
            node=pseudo_id,
            kind="bridge_assistant",
            label="Acknowledgement",
            finalContentChars=len(ack),
        )
        await log_event(
            job_id, "flow.bridge.assistant",
            {"text": ack, "beforeNode": before_node, "pseudoId": pseudo_id},
        )

    async def bridge_assistant_to_user(before_node: str) -> None:
        bridge_counter["n"] += 1
        pseudo_id = f"__bridge_user_{bridge_counter['n']}__"
        await _emit_event(
            job_id, run["id"],
            event="flow.node.start",
            node=pseudo_id,
            kind="bridge_user",
            label="Customer follow-up",
        )
        follow_up = await _simulate_user_follow_up(
            persona_ctx=persona_ctx, lang_ctx=lang_ctx, messages=messages,
            base_url=base_url, api_key=api_key, model=run["model"],
            extra_headers=extra_headers,
            job_id=job_id, run_id=run["id"], node_id=pseudo_id,
        )
        messages.append({"role": "user", "content": follow_up})
        nonlocal user_turn_count
        user_turn_count += 1
        await _emit_event(
            job_id, run["id"],
            event="flow.step",
            node=pseudo_id,
            kind="bridge_user",
            label="Customer follow-up",
            finalContentChars=len(follow_up),
        )
        await log_event(
            job_id, "flow.bridge.user",
            {"beforeNode": before_node, "text": follow_up, "pseudoId": pseudo_id},
        )

    current = start
    for step in range(_MAX_STEPS):
        kind = current.get("type")
        data = current.get("data") or {}

        # Bridge BEFORE the `flow.node.start` SSE so the synthesized turn
        # appears in the live preview as a user_turn / assistant_turn block
        # ABOVE the next flow_node card — natural reading order.
        if kind in ("action", "end") and messages and messages[-1].get("role") == "assistant":
            await bridge_assistant_to_user(current.get("id") or "")
        elif kind == "intent" and messages and messages[-1].get("role") == "user":
            await bridge_user_to_assistant(current.get("id") or "")

        # Bump the visit counter for this node. Used downstream by
        # condition-node `maxAttempts` enforcement so loops terminate
        # after the configured number of retries.
        _cur_node_id = current.get("id") or ""
        visit_counts[_cur_node_id] = visit_counts.get(_cur_node_id, 0) + 1

        # Ambient anti-infinite-loop guard for nodes without an explicit
        # `maxAttempts`. Breaks out of the flow with a stub closing turn
        # so a misconfigured cycle can't hang a job indefinitely.
        if visit_counts[_cur_node_id] > _MAX_VISITS_PER_NODE:
            await log_event(
                job_id,
                "flow.loop.guard_tripped",
                {"node": _cur_node_id, "visits": visit_counts[_cur_node_id]},
            )
            messages.append({
                "role": "assistant",
                "content": (
                    "(Flow exited: a node was visited too many times. "
                    "Add `maxAttempts` on a condition + an `exhausted` "
                    "branch to bound this loop.)"
                ),
            })
            break

        # Fire a `flow.node.start` SSE event so the live preview can paint
        # the current node as ACTIVE in the graph before we do any work
        # on it. Paired with `emit_flow_step` below which fires AFTER the
        # node completes (carries the result summary AND flips the card
        # off `running…`).
        await _emit_event(
            job_id, run["id"],
            event="flow.node.start",
            node=_cur_node_id,
            kind=kind,
            label=data.get("label"),
            attempt=visit_counts[_cur_node_id],
        )

        if kind == "start":
            # Generate an opening user-side greeting. Was a no-op, which
            # made every saved conversation skip the customer's "hello"
            # and open straight with the intent paraphrase — out of step
            # with what a real chat looks like.
            greeting = await _start_to_user_greeting(
                start_data=data,
                persona_ctx=persona_ctx,
                lang_ctx=lang_ctx,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
                job_id=job_id,
                run_id=run["id"],
                node_id=current.get("id") or "",
            )
            messages.append({"role": "user", "content": greeting})
            user_turn_count += 1
            await emit_flow_step({
                "node": current.get("id"),
                "kind": "start",
                "label": data.get("label"),
                "userText": greeting,
            })

        elif kind == "intent":
            # (Bridge is handled in the outer loop now — runs BEFORE
            # `flow.node.start` so the synthesized assistant ack renders
            # ABOVE the intent node's card in the live preview, not below.)
            user_text = await _intent_to_user_text(
                intent_data=data,
                persona_ctx=persona_ctx,
                lang_ctx=lang_ctx,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
                rng=rng,
                job_id=job_id,
                run_id=run["id"],
                node_id=current.get("id") or "",
            )
            messages.append({"role": "user", "content": user_text})
            user_turn_count += 1
            await emit_flow_step({
                "node": current.get("id"),
                "kind": "intent",
                "label": data.get("label"),
                "userText": user_text,
            })

        elif kind == "action":
            visited_actions += 1
            res = await _run_action(
                action_data=data,
                node_id=current.get("id") or "",
                tool_defs_by_id=tool_defs_by_id,
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                temperature=temperature,
                max_tokens=max_tokens,
                extra_headers=extra_headers,
                reasoning_effort=reasoning_effort,
                chat_template_kwargs=chat_template_kwargs,
                job_id=job_id,
                run_id=run["id"],
            )
            total_tokens_in += res["tokens_in"]
            total_tokens_out += res["tokens_out"]
            total_cost += res["cost_usd"]
            upstream_model = res.get("model") or upstream_model
            await emit_flow_step({
                "node": current.get("id"),
                "kind": "action",
                "label": data.get("label"),
                "toolCount": len(data.get("toolIds") or []),
                "finalContentChars": len(res.get("final_content") or ""),
            })

        elif kind == "condition":
            outs = adj.get(current.get("id") or "") or []
            # Loop / retry bound: when the condition has a `maxAttempts`
            # configured AND we've already visited this node that many
            # times, the runner forces the "exhausted" / "failed" /
            # "escalated" / "max_retries" branch (whichever label exists)
            # regardless of what the LLM picker would choose. Lets flow
            # authors write "verify IC 3 times, else escalate" by adding
            # a `data.maxAttempts: 3` field on the condition and an edge
            # labeled `exhausted` (or similar).
            attempt = visit_counts.get(current.get("id") or "", 1)
            raw_max = data.get("maxAttempts")
            max_attempts = (
                int(raw_max)
                if isinstance(raw_max, (int, float)) and raw_max > 0
                else None
            )
            EXHAUST_LABELS = {
                "exhausted", "max_retries", "max_attempts", "failed",
                "escalated", "give_up", "gave_up", "timeout",
            }
            exhausted_idx: int | None = None
            for i, (_t, lbl) in enumerate(outs):
                if isinstance(lbl, str) and lbl.lower() in EXHAUST_LABELS:
                    exhausted_idx = i
                    break

            if max_attempts and attempt > max_attempts and exhausted_idx is not None:
                choice_idx = exhausted_idx
                await log_event(
                    job_id,
                    "flow.bounded_loop.exhausted",
                    {
                        "node": current.get("id"),
                        "attempts": attempt,
                        "maxAttempts": max_attempts,
                        "forcedLabel": outs[choice_idx][1],
                    },
                )
            else:
                choice_idx = await _pick_condition_branch(
                    condition_data=data,
                    candidates=outs,
                    messages=messages,
                    base_url=base_url,
                    api_key=api_key,
                    model=run["model"],
                    extra_headers=extra_headers,
                    job_id=job_id,
                    run_id=run["id"],
                    node_id=current.get("id") or "",
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
            await emit_flow_step({
                "node": current.get("id"),
                "kind": "condition",
                "label": data.get("label"),
                "options": [lbl for _, lbl in outs],
                "chose": choice_idx,
                "chosenLabel": outs[choice_idx][1] if outs else None,
                "attempt": attempt,
                "maxAttempts": max_attempts,
            })
            # Skip the generic "first outgoing edge" picker below — use the chosen one.
            if outs:
                next_id = outs[choice_idx][0]
                current = by_id.get(next_id)
                if current is None:
                    break
                continue
            break

        elif kind == "end":
            # (Bridge handled in outer loop, same as action.)

            closing = await _produce_closing(
                end_data=data,
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
                job_id=job_id,
                run_id=run["id"],
                node_id=current.get("id") or "",
            )
            messages.append({"role": "assistant", "content": closing["content"]})
            total_tokens_in += closing["tokens_in"]
            total_tokens_out += closing["tokens_out"]
            total_cost += closing["cost_usd"]
            await emit_flow_step(
                {
                    "node": current.get("id"),
                    "kind": "end",
                    "label": data.get("label"),
                    "outcome": data.get("outcome"),
                    "finalContentChars": len(closing.get("content") or ""),
                },
            )
            break

        # Follow the first outgoing edge for non-condition nodes.
        outs = adj.get(current.get("id") or "") or []
        if not outs:
            break
        next_id = outs[0][0]
        current = by_id.get(next_id)
        if current is None:
            break

    elapsed_ms = int((time.perf_counter() - started) * 1000)

    # Validate the final assistant turn (if any).
    final_assistant = next(
        (m for m in reversed(messages) if m.get("role") == "assistant"), None
    )
    final_content = (final_assistant or {}).get("content") or ""

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
    verdicts = run_pipeline(final_content, vctx)
    for v in verdicts:
        await log_event(
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
    cost_usd = total_cost
    token_count = total_tokens_in + total_tokens_out

    # Tally tool invocations from the walked messages so we can record what was
    # actually called (vs. merely available to the conversation).
    invoked_counts: dict[str, int] = {}
    for m in messages:
        if m.get("role") == "assistant":
            for tc in m.get("tool_calls") or []:
                name = (tc.get("function") or {}).get("name")
                if isinstance(name, str):
                    invoked_counts[name] = invoked_counts.get(name, 0) + 1
    tools_invoked = [{"name": k, "count": v} for k, v in sorted(invoked_counts.items())]

    # Build the settings snapshot. We import lazily from generation.py to reuse
    # the resolver — flow_runner is already imported FROM generation.py, so a
    # module-top import would create a cycle.
    from .generation import _settings_snapshot as _build_settings

    settings_snapshot = await _build_settings(
        run=run,
        persona=persona,
        node=None,  # flow-driven runs aren't anchored to a single taxonomy node
        lp=lp,
        template=None,  # flow-driven runs don't render a single template
        provider=provider,
        policy=policy,
        sampling=_as_dict(run.get("samplingParams")),
        difficulty=difficulty,
        mode="flow-driven",
        flow=flow,
        tools_invoked=tools_invoked,
        tool_ids_override=sorted(referenced_tool_ids),
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
                None,  # flow-driven runs aren't anchored to a single taxonomy node.
                ctx_blob.get("personaId"),
                primary_lang,
                lp.get("script") or "latin",
                difficulty,
                user_turn_count,
                token_count,
                "rejected" if has_fail else "accepted",
                _content_hash(final_content),
                # Pass the dict directly (NOT json.dumps): asyncpg's jsonb
                # codec encodes on the way out; pre-stringifying causes
                # double-encoding and the column ends up as a JSON-string.
                settings_snapshot,
            )

            ordinal = 0
            for m in messages:
                role = m.get("role")
                content = m.get("content") or ""
                # Pass the Python list directly — the asyncpg jsonb codec
                # already json.dumps() encodes it. Pre-stringifying here causes
                # the column to hold `"[{…}]"` (a JSON string of a JSON
                # string) instead of `[{…}]`, which then renders as a string
                # in the UI.
                tool_calls_obj = (
                    m.get("tool_calls")
                    if role == "assistant" and m.get("tool_calls")
                    else None
                )
                tool_call_id = m.get("tool_call_id") if role == "tool" else None
                await conn.execute(
                    """
                    INSERT INTO "Message"
                       (id, "conversationId", ordinal, role, content, "toolCalls",
                        "toolCallId", language, script, model, "createdAt")
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, NOW())
                    """,
                    cuid_like(),
                    conv_id,
                    ordinal,
                    role,
                    content,
                    tool_calls_obj,
                    tool_call_id,
                    primary_lang if role == "assistant" else None,
                    lp.get("script") or "latin" if role == "assistant" else None,
                    upstream_model if role == "assistant" else None,
                )
                ordinal += 1

            for v in verdicts:
                await conn.execute(
                    """INSERT INTO "Validation"
                       (id, "conversationId", "validatorKind", axis, verdict, score,
                        details, "createdAt")
                       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())""",
                    cuid_like(),
                    conv_id,
                    v.validator_kind,
                    v.axis,
                    v.verdict,
                    v.score,
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
                job_id,
                conv_id,
                total_tokens_in,
                total_tokens_out,
                cost_usd,
                elapsed_ms,
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
                cost_usd,
            )

            await conn.execute(
                "SELECT pg_notify('synthgen_run', $1)",
                json.dumps({"runId": run["id"], "event": "job.done", "jobId": job_id}),
            )

    await log_event(
        job_id,
        "conversation.persisted",
        {
            "conversationId": conv_id,
            "status": "rejected" if has_fail else "accepted",
            "primaryLanguage": primary_lang,
            "turnCount": user_turn_count,
            "tokenCount": token_count,
            "actionNodesVisited": visited_actions,
        },
    )
    return conv_id


def _content_hash(text: str) -> str:
    import hashlib

    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()
