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
from typing import Any

from ..providers import chat_completion


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

    system_prompt = f"""You are a strict, impartial judge scoring a candidate AI model's
response against a reference response produced by a stronger model.

You will receive:
- The conversation system prompt and user input(s).
- The REFERENCE assistant output (treat as a strong but not infallible benchmark).
- The CANDIDATE assistant output (the model under evaluation).

You will score the candidate on these axes:

{axes_block}

Scoring rules:
- Each score is an integer on the axis's stated scale (1 = worst, top = best).
- Compare to the reference for *content fidelity* axes (faithfulness, helpfulness)
  but do NOT penalise paraphrasing or stylistic differences.
- Compare to the user's needs and the conversation context for *quality* axes
  (language fidelity, register, safety). The reference is just one data point;
  judge absolutely on the rubric description.
- Pick a single overall verdict: "pass" if every axis scores >= 60% of its scale,
  "warn" if any axis scores in the lower-middle (30-59%), "fail" if any axis
  scores below 30% of its scale.
- Be specific and brief in the rationale (≤ 3 sentences).

Return ONLY a single JSON object — no surrounding text, no markdown fences:

{{
  "scores": {{
  {score_schema}
  }},
  "verdict": "pass" | "warn" | "fail",
  "rationale": "≤ 3 sentence explanation"
}}
"""
    user_prompt = f"""SYSTEM PROMPT (from the original conversation):
{system_text or '(no system prompt was used)'}

CONVERSATION INPUT(S):
{_format_messages([m for m in reference_messages if m.get('role') in ('user', 'tool')]) or user_text}

REFERENCE (assistant output produced by the stronger generator):
{_format_messages([m for m in reference_messages if m.get('role') == 'assistant'])}

CANDIDATE (assistant output produced by the model under test):
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
        temperature=0.0,
        top_p=1.0,
        max_tokens=2000,
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
