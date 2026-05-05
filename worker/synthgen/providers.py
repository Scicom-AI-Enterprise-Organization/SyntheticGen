"""OpenAI-compatible chat-completions client.

Single thin wrapper around httpx — works for OpenAI, vLLM, Together, OpenRouter,
SGLang, and Anthropic via OpenAI-compat proxies. We avoid the official SDK so the
same code path serves every backend.
"""
from __future__ import annotations

import json
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
    _apply_reasoning_controls(payload, reasoning_effort, chat_template_kwargs)

    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        # Retry on 5xx and 429.
        if response.status_code >= 500 or response.status_code == 429:
            response.raise_for_status()
        response.raise_for_status()
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    raw = response.json()
    choice = (raw.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    tool_calls = msg.get("tool_calls")

    usage = raw.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
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


async def chat_completion_stream(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.7,
    max_tokens: int | None = 1500,
    extra_headers: Optional[dict[str, str]] = None,
    timeout: float = 180.0,
    reasoning_effort: Optional[str] = None,
    chat_template_kwargs: Optional[dict[str, Any]] = None,
) -> AsyncIterator[StreamEvent]:
    """Stream OpenAI-compat chat completion deltas. Yields delta events, then a final
    done event with `full_text` and usage stats."""
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
        "stream": True,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    _apply_reasoning_controls(payload, reasoning_effort, chat_template_kwargs)

    full: list[str] = []
    tokens_in = 0
    tokens_out = 0
    upstream_model = model
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
                usage = event.get("usage")
                if usage:
                    tokens_in = int(usage.get("prompt_tokens") or 0)
                    tokens_out = int(usage.get("completion_tokens") or 0)
    yield StreamEvent(
        done=True,
        full_text="".join(full),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        model=upstream_model,
    )
