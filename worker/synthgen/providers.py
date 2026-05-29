"""OpenAI-compatible chat-completions client.

Single thin wrapper around httpx — works for OpenAI, vLLM, Together, OpenRouter,
SGLang, and Anthropic via OpenAI-compat proxies. We avoid the official SDK so the
same code path serves every backend.
"""
from __future__ import annotations

import json
import re
import secrets
import string
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


# Pricing per 1M tokens (input, output) in USD. Source: vendor pricing pages.
# Unknown models cost 0 — we do not block on missing prices.
PRICING_USD_PER_M_TOKENS: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "o1-mini": (3.00, 12.00),
    # Together / open-source
    "meta-llama/Llama-3.3-70B-Instruct-Turbo": (0.88, 0.88),
    "Qwen/Qwen2.5-72B-Instruct-Turbo": (1.20, 1.20),
    "mesolitica/malaysian-llama-3.2-3b-instruct": (0.10, 0.10),
}


@dataclass
class ChatResult:
    content: str
    tool_calls: list[dict[str, Any]] | None
    raw: dict[str, Any]
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int
    model: str
    finish_reason: str | None


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    pricing = PRICING_USD_PER_M_TOKENS.get(model)
    if not pricing:
        return 0.0
    in_rate, out_rate = pricing
    return (tokens_in * in_rate + tokens_out * out_rate) / 1_000_000


# Fallback char→token ratio used only when the upstream provider fails to
# return `usage.prompt_tokens` (some vLLM builds drop it from streamed
# responses despite `stream_options.include_usage`). ~4 chars/token matches
# the well-known OpenAI heuristic and is close enough for accounting; the
# real `usage` is preferred whenever available.
_CHARS_PER_TOKEN = 4


def _estimate_tokens_from_text(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // _CHARS_PER_TOKEN)


def estimate_prompt_tokens(
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]] = None,
) -> int:
    """Char-based fallback for `usage.prompt_tokens` when the upstream omits it.

    Sums message content (string or OpenAI multipart), tool_call name+args, and
    the tool schema if `tools` was sent. Result is order-of-magnitude correct —
    not a substitute for real tokenizer counts, but vastly better than the
    accidental zero we used to persist.
    """
    total_chars = 0
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            total_chars += len(c)
        elif isinstance(c, list):
            for part in c:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    total_chars += len(part["text"])
        for tc in m.get("tool_calls") or []:
            fn = (tc or {}).get("function") or {}
            total_chars += len(fn.get("name") or "")
            total_chars += len(fn.get("arguments") or "")
        if isinstance(m.get("name"), str):
            total_chars += len(m["name"])
    if tools:
        try:
            total_chars += len(json.dumps(tools, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            pass
    return max(1, total_chars // _CHARS_PER_TOKEN)


# ── Inline tool-call sentinel parsing ─────────────────────────────────────
# Some vLLM tool-call parsers (Mistral in particular) don't reliably stream
# structured tool_calls in deltas — the model's raw sentinel + JSON ends up
# inside delta.content instead, and we'd persist zero tool_calls even though
# the model invoked them correctly. Parse the sentinel client-side as a
# fallback. Covers Mistral's `[TOOL_CALLS]` and Qwen's `<tool_call>` formats.
#
# Two Mistral flavours observed in the wild:
#   1. Non-streaming / official format — JSON array following the sentinel:
#        [TOOL_CALLS][{"name": "...", "arguments": {...}}, ...]
#   2. vLLM streaming format — bare identifier + JSON object, possibly
#      concatenated for multiple calls:
#        [TOOL_CALLS]get_weather{"location": "KL"}calculate{"expression": "1+2"}
#
# We accept both. The Qwen <tool_call>…</tool_call> form is also covered.
_MISTRAL_SENTINEL = "[TOOL_CALLS]"
_QWEN_TOOL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _find_balanced_json(text: str, start: int) -> Optional[tuple[int, int, Any]]:
    """Find the JSON value (object or array) starting at the first
    `{` or `[` after `start`. Returns (open_idx, end_exclusive_idx,
    parsed_value) or None. Skips over strings (and escaped quotes) so
    braces inside string values don't fool the matcher.
    """
    n = len(text)
    i = start
    while i < n and text[i] not in "{[":
        if not text[i].isspace():
            return None
        i += 1
    if i >= n:
        return None
    open_ch = text[i]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    j = i
    while j < n:
        ch = text[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return i, j + 1, json.loads(text[i : j + 1])
                    except json.JSONDecodeError:
                        return None
        j += 1
    return None


def _parse_mistral_sentinel(text: str) -> tuple[list[dict[str, Any]], str]:
    """Parse one or more `[TOOL_CALLS]…` blocks out of `text`.

    Handles both the official array form and vLLM's streaming
    bare-name-then-object form. Returns (tool_calls, cleaned_text).
    """
    out: list[dict[str, Any]] = []
    pieces: list[str] = []
    cursor = 0
    n = len(text)
    while True:
        idx = text.find(_MISTRAL_SENTINEL, cursor)
        if idx < 0:
            pieces.append(text[cursor:])
            break
        # Keep everything before the sentinel as content.
        pieces.append(text[cursor:idx])
        i = idx + len(_MISTRAL_SENTINEL)
        # Skip whitespace.
        while i < n and text[i].isspace():
            i += 1
        if i >= n:
            cursor = n
            break
        # Case A: JSON array follows ("official" format).
        if text[i] == "[":
            scan = _find_balanced_json(text, i)
            if scan and isinstance(scan[2], list):
                for entry in scan[2]:
                    norm = _normalise_inline_tool_call(entry)
                    if norm:
                        out.append(norm)
                cursor = scan[1]
                continue
            # Malformed — keep the literal text as content and move on.
            cursor = idx + len(_MISTRAL_SENTINEL)
            pieces.append(_MISTRAL_SENTINEL)
            continue
        # Case B: zero or more `<name>{json}` pairs in sequence.
        progressed = False
        while i < n:
            mname = _IDENT_RE.match(text, i)
            if not mname:
                break
            j = mname.end()
            # Allow optional whitespace between name and object.
            while j < n and text[j].isspace():
                j += 1
            if j >= n or text[j] != "{":
                break
            scan = _find_balanced_json(text, j)
            if not scan or not isinstance(scan[2], dict):
                break
            norm = _normalise_inline_tool_call(
                {"name": mname.group(0), "arguments": scan[2]}
            )
            if norm:
                out.append(norm)
            i = scan[1]
            progressed = True
        if not progressed:
            # Sentinel with nothing parseable after it — drop the sentinel,
            # keep the rest as content so we don't lose model output.
            cursor = idx + len(_MISTRAL_SENTINEL)
            continue
        cursor = i
    cleaned = "".join(pieces).strip() if out else text
    return out, cleaned


def _new_tool_call_id() -> str:
    alphabet = string.ascii_letters + string.digits
    return "call_" + "".join(secrets.choice(alphabet) for _ in range(20))


def _normalise_inline_tool_call(d: Any) -> Optional[dict[str, Any]]:
    """Coerce a Mistral/Qwen-style {name, arguments} dict into OpenAI's
    {id, type:"function", function:{name, arguments(JSON-string)}} shape.
    """
    if not isinstance(d, dict):
        return None
    fn = d.get("function") if isinstance(d.get("function"), dict) else None
    name = d.get("name") or (fn.get("name") if fn else None)
    if not isinstance(name, str) or not name:
        return None
    args: Any = d.get("arguments")
    if args is None and fn:
        args = fn.get("arguments")
    if args is None:
        args_str = "{}"
    elif isinstance(args, str):
        args_str = args
    else:
        try:
            args_str = json.dumps(args, ensure_ascii=False)
        except (TypeError, ValueError):
            args_str = "{}"
    return {
        "id": d.get("id") or _new_tool_call_id(),
        "type": "function",
        "function": {"name": name, "arguments": args_str},
    }


def parse_inline_tool_calls(text: str) -> tuple[list[dict[str, Any]], str]:
    """Scan `text` for Mistral / Qwen tool-call sentinels and parse them
    into OpenAI-shape tool_calls.

    Returns (tool_calls, cleaned_text). When no sentinel is found returns
    ([], text) unchanged. Safe to call on any model's content — it's a
    best-effort fallback for when the server didn't structure them.
    """
    if not text:
        return [], text
    out: list[dict[str, Any]] = []
    cleaned = text

    if _MISTRAL_SENTINEL in cleaned:
        mistral_calls, mistral_cleaned = _parse_mistral_sentinel(cleaned)
        if mistral_calls:
            out.extend(mistral_calls)
            cleaned = mistral_cleaned

    # Qwen / Hermes: one or more `<tool_call>{...}</tool_call>` blocks.
    qwen_matches = list(_QWEN_TOOL_RE.finditer(cleaned))
    if qwen_matches:
        parsed_any = False
        for qm in qwen_matches:
            try:
                obj = json.loads(qm.group(1))
            except json.JSONDecodeError:
                continue
            norm = _normalise_inline_tool_call(obj)
            if norm:
                out.append(norm)
                parsed_any = True
        if parsed_any:
            cleaned = _QWEN_TOOL_RE.sub("", cleaned).strip()

    return out, cleaned


def _apply_reasoning_controls(
    payload: dict[str, Any],
    reasoning_effort: Optional[str],
    chat_template_kwargs: Optional[dict[str, Any]],
) -> None:
    """Mutate `payload` in place with provider reasoning controls.

    - `reasoning_effort` → top-level `reasoning_effort` (OpenAI o-series convention).
    - `chat_template_kwargs` → forwarded verbatim under `chat_template_kwargs`.
      For vLLM Qwen3 the user typically configures `{"enable_thinking": false}`;
      we mirror that boolean to the top-level `include_reasoning` field so the
      server also drops `delta.reasoning` chunks (vLLM needs both knobs to fully
      suppress thinking).
    """
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if isinstance(chat_template_kwargs, dict) and chat_template_kwargs:
        payload["chat_template_kwargs"] = dict(chat_template_kwargs)
        if "enable_thinking" in chat_template_kwargs:
            payload["include_reasoning"] = bool(chat_template_kwargs["enable_thinking"])


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
)
async def chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.7,
    top_p: float = 1.0,
    max_tokens: int | None = 1024,
    seed: int | None = None,
    tools: list[dict[str, Any]] | None = None,
    timeout: float = 120.0,
    extra_headers: Optional[dict[str, str]] = None,
    reasoning_effort: Optional[str] = None,
    chat_template_kwargs: Optional[dict[str, Any]] = None,
) -> ChatResult:
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if seed is not None:
        payload["seed"] = seed
    if tools:
        payload["tools"] = tools
        # Explicit "auto" — OpenAI defaults to this when tools are present, but
        # some OpenAI-compat servers (vLLM in particular) treat the absence as
        # "do not invoke", which leaves the model refusing with "I don't have
        # access" even though the catalog is in the request.
        payload["tool_choice"] = "auto"
    _apply_reasoning_controls(payload, reasoning_effort, chat_template_kwargs)

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.status_code >= 400:
            # Include the body in the raised error so the caller's log
            # surfaces what upstream actually complained about (vLLM 400s
            # often carry the specific field name in the JSON body).
            body_snippet = response.text[:600] if response.text else ""
            raise httpx.HTTPStatusError(
                f"upstream {response.status_code}: {body_snippet}",
                request=response.request,
                response=response,
            )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    raw = response.json()
    choice = (raw.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    tool_calls = msg.get("tool_calls")
    # Fallback: some vLLM tool-call parsers (Mistral in particular) emit
    # the raw sentinel inside content instead of populating tool_calls,
    # especially in streaming mode. Parse it client-side so downstream
    # code sees a uniform shape regardless of server-side parser quirks.
    if not tool_calls and content:
        inline, cleaned = parse_inline_tool_calls(content)
        if inline:
            tool_calls = inline
            content = cleaned

    usage = raw.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
    if tokens_in == 0:
        tokens_in = estimate_prompt_tokens(messages, tools)
    if tokens_out == 0 and content:
        tokens_out = _estimate_tokens_from_text(content)
    finish_reason = choice.get("finish_reason")
    cost = estimate_cost(model, tokens_in, tokens_out)

    return ChatResult(
        content=content,
        tool_calls=tool_calls,
        raw=raw,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost,
        latency_ms=elapsed_ms,
        model=raw.get("model") or model,
        finish_reason=finish_reason,
    )


@dataclass
class StreamEvent:
    delta: str = ""
    reasoning: bool = False
    done: bool = False
    full_text: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""
    error: str = ""
    # Set on the final `done` event when the upstream emitted tool_calls. Same
    # shape as the non-streaming chat_completion path: list of
    # {id, type, function: {name, arguments}} dicts, with arguments as a
    # JSON-encoded string.
    tool_calls: Optional[list[dict[str, Any]]] = None
    # When tool_calls are streaming in (per-delta name/arguments fragments), we
    # also surface a "delta.tool_call" marker so the UI can render progress
    # like "[calling foo({a: 1, ...})]" even before [DONE] arrives.
    tool_call_delta: Optional[dict[str, Any]] = None


async def chat_completion_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.7,
    top_p: float = 1.0,
    max_tokens: int | None = 1500,
    seed: int | None = None,
    tools: Optional[list[dict[str, Any]]] = None,
    tool_choice: Optional[Any] = None,
    extra_headers: Optional[dict[str, str]] = None,
    timeout: float = 180.0,
    reasoning_effort: Optional[str] = None,
    chat_template_kwargs: Optional[dict[str, Any]] = None,
) -> AsyncIterator[StreamEvent]:
    """Stream OpenAI-compat chat completion deltas, including tool_calls.

    Yields content / reasoning deltas as they arrive, plus per-fragment
    `tool_call_delta` events so the UI can show tool invocations in real time.
    The final `done` event carries the full content, usage stats, and the
    accumulated `tool_calls` list (or None if the model didn't call any).
    """
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    if extra_headers:
        headers.update(extra_headers)

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "stream": True,
        # Without this, vLLM / OpenAI omit `usage` from streamed responses and
        # we end up persisting tokensIn=0 / tokensOut=0 for every conversation.
        "stream_options": {"include_usage": True},
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if seed is not None:
        payload["seed"] = seed
    if tools:
        payload["tools"] = tools
        # vLLM's Mistral tool-call parser (and some others) only routes
        # through the parser when tool_choice is explicitly set. Without
        # this, Mistral returns the [TOOL_CALLS] sentinel inside the raw
        # content text and we see zero structured tool_calls in deltas.
        # Caller may override with "required" or {"type":"function", ...}
        # to force a specific tool (flow action nodes use this so the
        # configured tool actually gets invoked instead of the model
        # answering in plain text).
        payload["tool_choice"] = tool_choice if tool_choice is not None else "auto"
    _apply_reasoning_controls(payload, reasoning_effort, chat_template_kwargs)

    full: list[str] = []
    tokens_in = 0
    tokens_out = 0
    upstream_model = model
    # Accumulators for streamed tool_calls. OpenAI sends them as deltas keyed
    # by `index` (a tool_call's position in the response). Each delta may
    # contribute the id, name, or another chunk of `arguments`.
    tc_acc: dict[int, dict[str, Any]] = {}

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise httpx.HTTPStatusError(
                    f"upstream {resp.status_code}: {body.decode('utf-8', 'replace')[:500]}",
                    request=resp.request,
                    response=resp,
                )
            async for line in resp.aiter_lines():
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                payload_str = line[len("data:"):].strip()
                if payload_str == "[DONE]":
                    break
                try:
                    event = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue
                if mdl := event.get("model"):
                    upstream_model = mdl
                choices = event.get("choices") or []
                if choices:
                    delta_obj = choices[0].get("delta") or {}
                    # Reasoning models (Qwen thinking, DeepSeek-R1, OpenAI o-series via
                    # some proxies) stream chain-of-thought as `delta.reasoning` first,
                    # then the actual answer as `delta.content`. Surface both for UX,
                    # but only `content` counts toward the final parsed payload.
                    reasoning_text = delta_obj.get("reasoning") or delta_obj.get("reasoning_content") or ""
                    if reasoning_text:
                        yield StreamEvent(delta=reasoning_text, reasoning=True)
                    delta_text = delta_obj.get("content") or ""
                    if delta_text:
                        full.append(delta_text)
                        yield StreamEvent(delta=delta_text)
                    # Streamed tool_calls: each entry has an `index` and may
                    # contribute the id, function.name, or a chunk of
                    # function.arguments. Accumulate per-index.
                    streamed_calls = delta_obj.get("tool_calls") or []
                    for tc in streamed_calls:
                        if not isinstance(tc, dict):
                            continue
                        idx = int(tc.get("index", 0))
                        slot = tc_acc.setdefault(
                            idx,
                            {"id": None, "type": "function", "function": {"name": "", "arguments": ""}},
                        )
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        if tc.get("type"):
                            slot["type"] = tc["type"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["function"]["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["function"]["arguments"] += fn["arguments"]
                        yield StreamEvent(tool_call_delta={
                            "index": idx,
                            "id": slot["id"],
                            "name": slot["function"]["name"],
                            "argumentsFragment": fn.get("arguments") or "",
                        })
                usage = event.get("usage")
                if usage:
                    tokens_in = int(usage.get("prompt_tokens") or 0)
                    tokens_out = int(usage.get("completion_tokens") or 0)

    final_tool_calls: Optional[list[dict[str, Any]]] = None
    if tc_acc:
        ordered = [tc_acc[k] for k in sorted(tc_acc.keys())]
        # Drop any incomplete slots (no name).
        final_tool_calls = [t for t in ordered if t["function"].get("name")] or None

    final_text = "".join(full)
    # Fallback: vLLM's Mistral tool-call parser frequently dumps the raw
    # `[TOOL_CALLS][...]` sentinel into delta.content instead of streaming
    # structured tool_calls — so the loop above accumulates nothing. Parse
    # it client-side. Also covers Qwen-style <tool_call>...</tool_call> if
    # a server returns it as text. Only runs when no structured tool_calls
    # were already received, so it's a strict fallback.
    if not final_tool_calls and final_text:
        inline, cleaned = parse_inline_tool_calls(final_text)
        if inline:
            final_tool_calls = inline
            final_text = cleaned
            # Emit a synthetic tool_call_delta so consumers that render
            # streaming markers ("[calling foo(...)]") still get one event
            # per recovered call. Replays the same shape the live-streamed
            # path produces.
            for idx, tc in enumerate(final_tool_calls):
                yield StreamEvent(tool_call_delta={
                    "index": idx,
                    "id": tc.get("id"),
                    "name": (tc.get("function") or {}).get("name") or "",
                    "argumentsFragment": (tc.get("function") or {}).get("arguments") or "",
                })
    # Fallback when the upstream forgot to include `usage` despite
    # stream_options.include_usage=True. Without this we persist 0 (or, after
    # multi-turn rollup, the simulator's tiny 83-token prompt) instead of the
    # real prompt size, which makes accounting numbers meaningless.
    if tokens_in == 0:
        tokens_in = estimate_prompt_tokens(messages, tools)
    if tokens_out == 0 and final_text:
        tokens_out = _estimate_tokens_from_text(final_text)

    yield StreamEvent(
        done=True,
        full_text=final_text,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        model=upstream_model,
        tool_calls=final_tool_calls,
    )
