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
from .providers import chat_completion, chat_completion_stream
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
    """Load ToolDef rows by id. Returns OpenAI-tools-formatted entries plus the
    raw row so we can synthesize mock responses."""
    if not tool_ids:
        return []
    rows = await db.fetch_all(
        """
        SELECT id, name, description, parameters, "mockSeed", "mockResponseSchema", examples
        FROM "ToolDef" WHERE id = ANY($1::text[])
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
) -> str:
    """Pick an example utterance verbatim if available, else paraphrase from
    the intent description via a quick LLM call so the turn lands in the right
    persona/language."""
    examples = intent_data.get("examples")
    if isinstance(examples, list) and examples:
        candidates = [e for e in examples if isinstance(e, str) and e.strip()]
        if candidates:
            return rng.choice(candidates)

    label = intent_data.get("label") or "user intent"
    description = intent_data.get("description") or ""
    sys = (
        "Produce ONE short user-side utterance (1-2 sentences) that expresses "
        "the intent below. Respond in the target language and register, in "
        "character for the given persona. Return ONLY the utterance — no "
        "preamble, no quotes, no role tag."
    )
    user = (
        f"Intent label: {label}\n"
        f"Intent description: {description}\n"
        f"Persona: {json.dumps(persona_ctx, ensure_ascii=False)}\n"
        f"Language: {lang_ctx.get('primary')} ({lang_ctx.get('register')})\n"
    )
    try:
        r = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.7,
            max_tokens=200,
            extra_headers=extra_headers,
        )
        text = (r.content or "").strip().strip('"').strip("'")
        return text or label
    except Exception as e:  # noqa: BLE001
        log.warning("intent paraphrase failed: %s", e)
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
) -> dict[str, Any]:
    """Run one action node. Returns a dict with the new messages appended (also
    mutates `messages` in-place) and aggregated token/cost counters."""
    tool_ids = action_data.get("toolIds") if isinstance(action_data.get("toolIds"), list) else []
    tools_for_call = [tool_defs_by_id[i] for i in tool_ids if i in tool_defs_by_id]
    tools_payload = _tools_payload(tools_for_call) if tools_for_call else None

    tokens_in = 0
    tokens_out = 0
    cost_usd = 0.0

    # The model can chain tool calls; cap at _TOOL_CALL_LIMIT.
    for _ in range(_TOOL_CALL_LIMIT):
        result = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=messages,
            tools=tools_payload,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_headers=extra_headers,
            reasoning_effort=reasoning_effort,
            chat_template_kwargs=chat_template_kwargs,
        )
        tokens_in += result.tokens_in
        tokens_out += result.tokens_out
        cost_usd += result.cost_usd

        tool_calls = result.tool_calls or []
        content = result.content or ""

        if tool_calls:
            assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": _normalise_tool_calls(tool_calls),
            }
            messages.append(assistant_msg)

            # Synthesize a result for each tool call in order.
            for tc in assistant_msg["tool_calls"]:
                fn = tc.get("function") or {}
                tool_name = fn.get("name")
                args_text = fn.get("arguments") or "{}"
                tool_def = next(
                    (t for t in tools_for_call if t.get("name") == tool_name), None
                )
                if tool_def is None:
                    tool_result = json.dumps(
                        {"error": f"unknown tool {tool_name!r}"}, ensure_ascii=False
                    )
                else:
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
            "model": result.model,
            "latency_ms": result.latency_ms,
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
            args = json.dumps(args, ensure_ascii=False)
        elif args is None:
            args = "{}"
        elif not isinstance(args, str):
            args = str(args)
        if name:
            out.append({
                "id": tc.get("id") or cuid_like(),
                "type": "function",
                "function": {"name": name, "arguments": args},
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
    for i, (_tgt, lbl) in enumerate(candidates):
        options_lines.append(f"{i}: {lbl or '(no label)'}")
    options_text = "\n".join(options_lines)
    transcript_tail = _short_transcript(messages, max_chars=2000)

    sys = (
        "You are a flow router. Given the conversation so far and a branching "
        "condition, choose which outgoing edge to follow. Return ONLY a single "
        "integer (the chosen option index). No surrounding text."
    )
    user = (
        f"Condition: {label}\n"
        f"Expression: {expression}\n\n"
        f"Options:\n{options_text}\n\n"
        f"Recent transcript:\n{transcript_tail}"
    )
    try:
        r = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.0,
            max_tokens=8,
            extra_headers=extra_headers,
        )
        raw = (r.content or "").strip()
        m = re.search(r"\d+", raw)
        if m:
            i = int(m.group(0))
            if 0 <= i < len(candidates):
                return i
    except Exception as e:  # noqa: BLE001
        log.warning("condition branch pick failed: %s", e)
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
    try:
        r = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=300,
            extra_headers=extra_headers,
        )
        text = (r.content or "").strip()
        return {
            "content": text or label,
            "tokens_in": r.tokens_in,
            "tokens_out": r.tokens_out,
            "cost_usd": r.cost_usd,
        }
    except Exception as e:  # noqa: BLE001
        log.warning("closing turn failed: %s", e)
        return {"content": label, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}


# ───── main entrypoint ──────────────────────────────────────────────────────

_MAX_STEPS = 24  # safety cap on node visits to avoid pathological cycles


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
    tool_defs_by_id = {t["id"]: t for t in tool_defs}

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
        },
    )

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

    messages: list[dict[str, Any]] = []
    if system_text:
        messages.append({"role": "system", "content": system_text})

    # Walk the graph.
    started = time.perf_counter()
    total_tokens_in = 0
    total_tokens_out = 0
    total_cost = 0.0
    upstream_model = run["model"]
    user_turn_count = 0
    visited_actions = 0

    current = start
    for step in range(_MAX_STEPS):
        kind = current.get("type")
        data = current.get("data") or {}

        if kind == "start":
            await log_event(job_id, "flow.step", {"node": current.get("id"), "kind": "start"})
            pass  # nothing to emit

        elif kind == "intent":
            user_text = await _intent_to_user_text(
                intent_data=data,
                persona_ctx=persona_ctx,
                lang_ctx=lang_ctx,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
                rng=rng,
            )
            messages.append({"role": "user", "content": user_text})
            user_turn_count += 1
            await log_event(
                job_id,
                "flow.step",
                {
                    "node": current.get("id"),
                    "kind": "intent",
                    "label": data.get("label"),
                    "userText": user_text,
                },
            )

        elif kind == "action":
            visited_actions += 1
            res = await _run_action(
                action_data=data,
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
            )
            total_tokens_in += res["tokens_in"]
            total_tokens_out += res["tokens_out"]
            total_cost += res["cost_usd"]
            upstream_model = res.get("model") or upstream_model
            await log_event(
                job_id,
                "flow.step",
                {
                    "node": current.get("id"),
                    "kind": "action",
                    "label": data.get("label"),
                    "toolCount": len(data.get("toolIds") or []),
                    "finalContentChars": len(res.get("final_content") or ""),
                },
            )

        elif kind == "condition":
            outs = adj.get(current.get("id") or "") or []
            choice_idx = await _pick_condition_branch(
                condition_data=data,
                candidates=outs,
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
            )
            await log_event(
                job_id,
                "flow.step",
                {
                    "node": current.get("id"),
                    "kind": "condition",
                    "label": data.get("label"),
                    "options": [lbl for _, lbl in outs],
                    "chose": choice_idx,
                    "chosenLabel": outs[choice_idx][1] if outs else None,
                },
            )
            # Skip the generic "first outgoing edge" picker below — use the chosen one.
            if outs:
                next_id = outs[choice_idx][0]
                current = by_id.get(next_id)
                if current is None:
                    break
                continue
            break

        elif kind == "end":
            closing = await _produce_closing(
                end_data=data,
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                extra_headers=extra_headers,
            )
            messages.append({"role": "assistant", "content": closing["content"]})
            total_tokens_in += closing["tokens_in"]
            total_tokens_out += closing["tokens_out"]
            total_cost += closing["cost_usd"]
            await log_event(
                job_id,
                "flow.step",
                {
                    "node": current.get("id"),
                    "kind": "end",
                    "label": data.get("label"),
                    "outcome": data.get("outcome"),
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
                json.dumps(settings_snapshot, ensure_ascii=False),
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
