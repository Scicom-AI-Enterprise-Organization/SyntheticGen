"""LLM-as-judge for chat-replay benchmarks.

Builds a rubric-driven prompt that asks the judge to score the candidate's
output on each axis the user defined, returns parsed scores + rationale.

The judge is deliberately *strict* about JSON output: we instruct it to emit
only the scoring object and parse with a tolerant fence-stripper. If the JSON
is malformed we return a `verdict=fail` with `judge_parse_failed=True` in the
details so the run continues rather than crashing.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Awaitable, Callable

from ..providers import chat_completion, chat_completion_stream, estimate_cost


log = logging.getLogger(__name__)

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _format_messages(messages: list[dict[str, Any]]) -> str:
    """Render a list of {role, content, tool_calls?} messages as a compact transcript
    the judge can read. Multi-turn shows roles inline so the judge can attribute who
    said what."""
    lines: list[str] = []
    for m in messages:
        role = (m.get("role") or "").upper()
        content = m.get("content") or ""
        tool_calls = m.get("tool_calls")
        if tool_calls:
            try:
                tc_text = json.dumps(tool_calls, ensure_ascii=False)
            except Exception:
                tc_text = str(tool_calls)
            lines.append(f"[{role}] {content}\n  tool_calls: {tc_text}")
        else:
            lines.append(f"[{role}] {content}")
    return "\n\n".join(lines)


def build_judge_prompt(
    *,
    rubric_axes: list[dict[str, Any]],
    system_text: str,
    user_text: str,
    reference_messages: list[dict[str, Any]],
    candidate_messages: list[dict[str, Any]],
) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for the judge call.

    `reference_messages` is the original assistant turn(s) from the project-generated
    conversation (the "gold" answer, typically produced by a stronger model like Opus).
    `candidate_messages` is what the smaller candidate model produced when re-prompted
    with the same user input(s).
    """
    axes_block_lines = []
    for axis in rubric_axes:
        key = axis.get("key", "axis")
        name = axis.get("name", key)
        desc = axis.get("description", "")
        scale = int(axis.get("scale", 5))
        examples = axis.get("examples") or []
        ex_lines = []
        for ex in examples:
            try:
                ex_score = int(ex.get("score"))
            except (TypeError, ValueError):
                continue
            out = (ex.get("output") or "")[:300]
            reason = ex.get("reason") or ""
            ex_lines.append(f"    - score={ex_score}: {out!r} ({reason})")
        ex_block = "\n".join(ex_lines)
        axes_block_lines.append(
            f"- key: {key}\n  name: {name}\n  scale: 1-{scale}\n  description: {desc}"
            + (f"\n  example anchors:\n{ex_block}" if ex_block else "")
        )
    axes_block = "\n".join(axes_block_lines)

    keys = [a.get("key", "axis") for a in rubric_axes]
    score_schema = "\n  ".join(f'"{k}": <integer score>,' for k in keys).rstrip(",")

    keys_list = ", ".join(f'"{k}"' for k in keys)
    fault_schema = "\n  ".join(f'"{k}": "<one-sentence fault or empty string if genuinely none>",' for k in keys).rstrip(",")

    system_prompt = f"""You are a STRICT, SKEPTICAL quality judge grading an
assistant's response for dataset-curation purposes. Your job is to
DIFFERENTIATE response quality so the user can rank generations. Uniform
top scores are useless — if you produce them, you have failed the task.

You will receive:
- The conversation system prompt and the user's input(s).
- The ASSISTANT'S RESPONSE — the output you must grade.

You will score the response on these axes:

{axes_block}

────────────────────────────────────────────────────────────────────────
SCORING DISCIPLINE — follow these rules in order:

STEP 1 — PER-AXIS FAULT HUNT (mandatory, do this FIRST):
For EACH axis listed above ({keys_list}), independently re-read the
response and ask: "what's the single biggest faultable thing on THIS
axis?" Look for:
  - missing instructions from the system prompt
  - register/tone slips (formal where casual, casual where formal)
  - awkward code-switching or unnatural phrasing
  - generic / non-specific language
  - missing concrete details a real user would expect
  - over-confident claims, hedging, or hallucinations
  - clunky or repetitive structure
Write a one-sentence fault per axis. ONLY leave a fault empty if you
have re-read the response and can credibly say "no improvement is
possible on this axis from any reviewer's perspective."

STEP 2 — SCORE FROM FAULTS:
For each axis, score based on the fault you found:
    top                = "I genuinely could not find a fault" (RARE —
                          requires the fault field to be empty)
    top - 1            = "I found one minor, defensible deduction"
    top - 2            = "I found a clear weakness or two"
    middle             = "mediocre — the axis is met but unimpressive"
    bottom third       = "the axis is missed (wrong language, wrong
                          register, unhelpful, unsafe, hallucinated)"

STEP 3 — DISTRIBUTION CHECK:
After scoring, count how many axes you put at the top. If MORE THAN ONE
axis is at the top, go back to Step 1 — you were too lenient. Real
responses almost always have a noticeable rough edge in 2+ areas. The
typical "good" response scores at top-1 across most axes, with maybe
ONE genuine top, NOT multiple tops.

STEP 4 — VERDICT:
    "pass" → every axis ≥ top-1 (i.e. 4 or 5 on a 5-pt scale) AND no
             obvious failures called out
    "warn" → at least one axis at mid-scale OR multiple axes at top-2
    "fail" → any axis at or below the bottom third

────────────────────────────────────────────────────────────────────────

Return ONLY a single JSON object — no surrounding text, no markdown fences.
The `faults` field must list a fault per axis (or empty string for a
genuine top score) — this is the audit trail your scores are based on.

{{
  "faults": {{
  {fault_schema}
  }},
  "scores": {{
  {score_schema}
  }},
  "verdict": "pass" | "warn" | "fail",
  "rationale": "≤ 3 sentences summarising the most important faults driving the verdict"
}}
"""
    # User prompt — no "REFERENCE" section anymore. In our judge-only
    # mode the reference IS the response being scored, so showing it
    # twice (once as reference, once as candidate) gave the judge a
    # 5/5-by-default bias.
    user_prompt = f"""SYSTEM PROMPT (from the original conversation):
{system_text or '(no system prompt was used)'}

CONVERSATION INPUT(S):
{_format_messages([m for m in reference_messages if m.get('role') in ('user', 'tool')]) or user_text}

ASSISTANT'S RESPONSE (the output to grade):
{_format_messages(candidate_messages)}
"""
    return system_prompt, user_prompt


def parse_judge_response(raw: str, rubric_axes: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract scores/verdict/rationale from the judge's text.

    Returns a dict with:
      scores: {axis_key: int}
      verdict: "pass" | "warn" | "fail"
      rationale: str
      _parsed_ok: bool
    """
    keys = [a.get("key", "axis") for a in rubric_axes]
    scales = {a.get("key", "axis"): int(a.get("scale", 5)) for a in rubric_axes}

    text = (raw or "").strip()
    text = _FENCE_RE.sub("", text).strip()
    # The judge sometimes prefixes with words like "Here is the scoring:"; try
    # to recover the first {...} block.
    if not text.startswith("{"):
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            text = match.group(0)

    try:
        parsed = json.loads(text)
    except Exception:
        log.warning("judge JSON parse failed; raw head=%s", (raw or "")[:200])
        return {
            "scores": {k: 0 for k in keys},
            "verdict": "fail",
            "rationale": f"Judge response was not valid JSON. Raw head: {(raw or '')[:200]}",
            "_parsed_ok": False,
        }

    raw_scores = parsed.get("scores") if isinstance(parsed, dict) else None
    scores: dict[str, int] = {}
    if isinstance(raw_scores, dict):
        for k in keys:
            v = raw_scores.get(k)
            try:
                iv = int(v)
            except (TypeError, ValueError):
                iv = 0
            # Clamp into [1, scale]; treat 0 as "missing/invalid → 1".
            top = scales.get(k, 5)
            scores[k] = max(1, min(top, iv)) if iv > 0 else 1
    else:
        scores = {k: 1 for k in keys}

    verdict = parsed.get("verdict") if isinstance(parsed, dict) else None
    if verdict not in ("pass", "warn", "fail"):
        # Derive verdict from scores.
        worst_frac = min(
            (scores[k] - 1) / max(1, (scales.get(k, 5) - 1)) for k in keys
        ) if keys else 0.0
        if worst_frac >= 0.6:
            verdict = "pass"
        elif worst_frac >= 0.3:
            verdict = "warn"
        else:
            verdict = "fail"

    rationale = parsed.get("rationale") if isinstance(parsed, dict) else ""
    if not isinstance(rationale, str):
        rationale = ""

    return {
        "scores": scores,
        "verdict": verdict,
        "rationale": rationale[:2000],
        "_parsed_ok": True,
    }


async def call_judge(
    *,
    base_url: str,
    api_key: str,
    model: str,
    rubric_axes: list[dict[str, Any]],
    system_text: str,
    user_text: str,
    reference_messages: list[dict[str, Any]],
    candidate_messages: list[dict[str, Any]],
    extra_headers: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
    chat_template_kwargs: dict[str, Any] | None = None,
    # Per-run overrides exposed through BenchmarkRun.samplingParams. When
    # omitted, fall back to the conservative defaults that worked well for
    # most local judges (low temperature for verdict stability, ~4k tokens
    # for verdict + rationale).
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """Call the judge model and return parsed scores + cost/tokens.

    Returns:
      {
        scores: {axis_key: int},
        verdict: "pass" | "warn" | "fail",
        rationale: str,
        tokens_in: int, tokens_out: int, cost_usd: float, latency_ms: int,
        _parsed_ok: bool,
      }
    """
    sys_prompt, user_prompt = build_judge_prompt(
        rubric_axes=rubric_axes,
        system_text=system_text,
        user_text=user_text,
        reference_messages=reference_messages,
        candidate_messages=candidate_messages,
    )
    result = await chat_completion(
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0 if temperature is None else float(temperature),
        top_p=1.0,
        max_tokens=4096 if max_tokens is None else int(max_tokens),
        extra_headers=extra_headers,
        reasoning_effort=reasoning_effort,
        chat_template_kwargs=chat_template_kwargs,
    )
    parsed = parse_judge_response(result.content, rubric_axes)
    parsed["tokens_in"] = result.tokens_in
    parsed["tokens_out"] = result.tokens_out
    parsed["cost_usd"] = result.cost_usd
    parsed["latency_ms"] = result.latency_ms
    return parsed


async def call_judge_streaming(
    *,
    base_url: str,
    api_key: str,
    model: str,
    rubric_axes: list[dict[str, Any]],
    system_text: str,
    user_text: str,
    reference_messages: list[dict[str, Any]],
    candidate_messages: list[dict[str, Any]],
    extra_headers: dict[str, str] | None = None,
    reasoning_effort: str | None = None,
    chat_template_kwargs: dict[str, Any] | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    # Total number of judge attempts before giving up. The first attempt
    # is at temperature `temperature`; retries bump the temperature
    # slightly (+0.1 per attempt) so the model doesn't deterministically
    # produce the same malformed output. Default 3 = 1 attempt + 2 retries.
    max_retries: int = 3,
    # Callback fired for every visible content delta. Receives (text)
    # and is expected to be a short async function — typically just
    # pg_notify. Reasoning deltas are NOT forwarded (they're noisy and
    # the UI only wants the final JSON output to render).
    on_delta: Callable[[str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    """Same as call_judge but streams the response so the caller can
    forward deltas to the Live Benchmark Preview SSE. Accumulates the
    full text + tokens internally, then parses identically to call_judge.

    Falls back to the non-streaming path if `on_delta` is None — there's
    no point paying the streaming cost if no one's listening.
    """
    if on_delta is None:
        # Non-streaming fallback — same retry loop, just without delta
        # forwarding.
        started_at = time.perf_counter()
        accum_in = 0
        accum_out = 0
        last_parsed: dict[str, Any] | None = None
        for attempt in range(max(1, max_retries)):
            base_t = 0.0 if temperature is None else float(temperature)
            r = await call_judge(
                base_url=base_url,
                api_key=api_key,
                model=model,
                rubric_axes=rubric_axes,
                system_text=system_text,
                user_text=user_text,
                reference_messages=reference_messages,
                candidate_messages=candidate_messages,
                extra_headers=extra_headers,
                reasoning_effort=reasoning_effort,
                chat_template_kwargs=chat_template_kwargs,
                temperature=base_t + 0.1 * attempt,
                max_tokens=max_tokens,
            )
            accum_in += int(r.get("tokens_in") or 0)
            accum_out += int(r.get("tokens_out") or 0)
            last_parsed = r
            if r.get("_parsed_ok"):
                r["tokens_in"] = accum_in
                r["tokens_out"] = accum_out
                r["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
                r["judge_retries_used"] = attempt
                return r
            log.warning(
                "judge response failed to parse (attempt %d/%d, model=%s)",
                attempt + 1,
                max_retries,
                model,
            )
        # Out of attempts — return the last (still-marked _parsed_ok=False) result.
        if last_parsed is not None:
            last_parsed["tokens_in"] = accum_in
            last_parsed["tokens_out"] = accum_out
            last_parsed["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
            last_parsed["judge_retries_used"] = max_retries - 1
            return last_parsed
        return {
            "scores": {},
            "verdict": "fail",
            "rationale": "judge call failed",
            "_parsed_ok": False,
            "tokens_in": 0,
            "tokens_out": 0,
            "cost_usd": 0.0,
            "latency_ms": int((time.perf_counter() - started_at) * 1000),
        }

    sys_prompt, user_prompt = build_judge_prompt(
        rubric_axes=rubric_axes,
        system_text=system_text,
        user_text=user_text,
        reference_messages=reference_messages,
        candidate_messages=candidate_messages,
    )
    started_at = time.perf_counter()
    base_t = 0.0 if temperature is None else float(temperature)
    accum_in = 0
    accum_out = 0
    last_full_text = ""

    for attempt in range(max(1, max_retries)):
        parts: list[str] = []
        tokens_in = 0
        tokens_out = 0
        full_text = ""
        try:
            async for ev in chat_completion_stream(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                # Bump temperature on retries so we don't deterministically
                # regenerate the same malformed JSON. +0.1 per attempt is
                # enough to perturb without breaking the scoring discipline.
                temperature=base_t + 0.1 * attempt,
                top_p=1.0,
                max_tokens=4096 if max_tokens is None else int(max_tokens),
                extra_headers=extra_headers,
                reasoning_effort=reasoning_effort,
                chat_template_kwargs=chat_template_kwargs,
            ):
                if ev.error:
                    continue
                if ev.done:
                    tokens_in = ev.tokens_in
                    tokens_out = ev.tokens_out
                    full_text = ev.full_text or "".join(parts)
                    break
                if ev.delta and not ev.reasoning:
                    parts.append(ev.delta)
                    try:
                        await on_delta(ev.delta)
                    except Exception:  # noqa: BLE001
                        # A misbehaving notify handler must not break the
                        # judge call.
                        pass
        except Exception as e:  # noqa: BLE001
            log.warning("judge stream failed (attempt %d/%d): %s", attempt + 1, max_retries, e)
            full_text = "".join(parts)

        accum_in += tokens_in
        accum_out += tokens_out
        last_full_text = full_text or last_full_text

        parsed = parse_judge_response(full_text, rubric_axes)
        if parsed.get("_parsed_ok"):
            parsed["tokens_in"] = accum_in
            parsed["tokens_out"] = accum_out
            parsed["cost_usd"] = estimate_cost(model, accum_in, accum_out)
            parsed["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
            parsed["judge_retries_used"] = attempt
            return parsed
        log.warning(
            "judge response failed to parse (attempt %d/%d, model=%s) — preview=%r",
            attempt + 1,
            max_retries,
            model,
            (full_text or "")[:200],
        )

    # All retries exhausted — return the last attempt's parse (with
    # _parsed_ok=False) so the run progresses with a degraded verdict
    # rather than crashing.
    parsed = parse_judge_response(last_full_text, rubric_axes)
    parsed["tokens_in"] = accum_in
    parsed["tokens_out"] = accum_out
    parsed["cost_usd"] = estimate_cost(model, accum_in, accum_out)
    parsed["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
    parsed["judge_retries_used"] = max_retries - 1
    return parsed
