"""Multi-judge ensemble re-judge (Tier-3) for chat-replay benchmarks.

The single-judge benchmark pipeline (chat_replay.py) ranks everything
cheaply with one judge. Once a run completes, an ensemble pass can
re-judge a SUBSET of high-value items with N additional judges, take
the median per-axis score, and flag disagreement. Lets the user trust
the top of the ranking without paying for multi-judge across the whole
100k.

Persistence: each BenchmarkResult row gets `ensembleResult` (JSONB with
per-judge breakdown + median + max-disagreement) and `ensembledAt`
(timestamp). The original judgeScores / judgeVerdict / judgeRationale
are left untouched — the ensemble is additive, not destructive.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from .. import db
from ..crypto import decrypt_secret
from .judge import call_judge_streaming


log = logging.getLogger(__name__)


def _parse_jsonb(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None
    return v


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    if n % 2 == 1:
        return float(s[n // 2])
    return (s[n // 2 - 1] + s[n // 2]) / 2.0


async def _load_judge_provider(provider_credential_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """
        SELECT id, name, "baseUrl", "encryptedApiKey", headers,
               "reasoningEffort", "chatTemplateKwargs"
        FROM "ProviderCredential" WHERE id = $1
        """,
        provider_credential_id,
    )
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["baseUrl"],
        "key": row["encryptedApiKey"],
        "headers": row["headers"],
        "reasoning_effort": row["reasoningEffort"],
        "chat_template_kwargs": row["chatTemplateKwargs"],
    }


async def _select_rows(
    run_id: str,
    rubric_axes: list[dict[str, Any]],
    *,
    conversation_ids: list[str] | None,
    verdict: str | None,
    min_axis_score: float | None,
    top_percent: float | None,
) -> list[dict[str, Any]]:
    """Pick which BenchmarkResult rows to ensemble-re-judge based on the
    filter the caller passed. Excludes per-turn detail rows so each
    conversation is ensembled once.
    """
    rows = await db.fetch_all(
        '''SELECT id, "conversationId", "judgeScores", "judgeVerdict",
                  "candidateMessages", "referenceMessages", split
           FROM "BenchmarkResult"
           WHERE "runId" = $1 AND kind = 'chat-replay'
           ORDER BY id''',
        run_id,
    )
    out: list[dict[str, Any]] = []
    scored: list[tuple[float, dict[str, Any]]] = []
    for r in rows:
        if conversation_ids is not None and r["conversationId"] not in conversation_ids:
            continue
        if verdict and r["judgeVerdict"] != verdict:
            continue
        scores = _parse_jsonb(r["judgeScores"]) or {}
        # Compute composite + min for downstream filters.
        nums = [v for v in scores.values() if isinstance(v, (int, float))]
        if not nums:
            continue
        composite = sum(nums) / len(nums)
        min_axis = min(nums)
        if min_axis_score is not None and min_axis < min_axis_score:
            continue
        entry = dict(r)
        entry["_composite"] = composite
        entry["_min_axis"] = min_axis
        scored.append((composite, entry))
        out.append(entry)
    # Top-percent: keep highest-composite rows up to ceil(N * topPercent).
    if top_percent is not None and top_percent > 0 and scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        target = max(1, int(len(scored) * top_percent + 0.999))
        out = [e for _, e in scored[:target]]
    return out


async def _run_one_judge(
    *,
    judge: dict[str, Any],
    model: str,
    rubric_axes: list[dict[str, Any]],
    system_text: str,
    user_text: str,
    reference_messages: list[dict[str, Any]],
    candidate_messages: list[dict[str, Any]],
    sampling: dict[str, Any],
) -> dict[str, Any]:
    """Wrap call_judge_streaming for a single ensemble member and shape
    the result so it slots into the JSONB array."""
    api_key = decrypt_secret(judge["key"])
    res = await call_judge_streaming(
        base_url=judge["base_url"],
        api_key=api_key,
        model=model,
        rubric_axes=rubric_axes,
        system_text=system_text,
        user_text=user_text,
        reference_messages=reference_messages,
        candidate_messages=candidate_messages,
        extra_headers=judge["headers"] if isinstance(judge["headers"], dict) else None,
        reasoning_effort=judge["reasoning_effort"],
        chat_template_kwargs=judge["chat_template_kwargs"] if isinstance(judge["chat_template_kwargs"], dict) else None,
        temperature=sampling.get("judge_temperature"),
        max_tokens=sampling.get("judge_max_tokens"),
        max_retries=int(sampling.get("judge_max_retries", 3) or 3),
        on_delta=None,  # ensemble doesn't stream — it's a batch tier-3 pass
    )
    return {
        "providerCredentialId": judge["id"],
        "providerName": judge["name"],
        "model": model,
        "scores": res.get("scores") or {},
        "verdict": res.get("verdict") or "fail",
        "rationale": res.get("rationale") or "",
        "tokensIn": int(res.get("tokens_in") or 0),
        "tokensOut": int(res.get("tokens_out") or 0),
        "costUsd": float(res.get("cost_usd") or 0.0),
        "latencyMs": int(res.get("latency_ms") or 0),
    }


def _aggregate(judges: list[dict[str, Any]], rubric_axes: list[dict[str, Any]]) -> dict[str, Any]:
    """Median per-axis + worst verdict + max disagreement across judges."""
    per_axis: dict[str, list[float]] = {}
    for j in judges:
        for k, v in (j.get("scores") or {}).items():
            if isinstance(v, (int, float)):
                per_axis.setdefault(k, []).append(float(v))
    median_scores = {k: _median(vs) for k, vs in per_axis.items()}
    max_spread = 0.0
    for vs in per_axis.values():
        if len(vs) > 1:
            max_spread = max(max_spread, max(vs) - min(vs))
    order = {"pass": 0, "warn": 1, "fail": 2}
    worst = "pass"
    for j in judges:
        v = j.get("verdict") or "fail"
        if order.get(v, 0) > order.get(worst, 0):
            worst = v
    return {
        "medianScores": median_scores,
        "worstVerdict": worst,
        "maxDisagreement": max_spread,
    }


async def execute_ensemble(
    run_id: str,
    *,
    judges_spec: list[dict[str, Any]],
    filter_spec: dict[str, Any],
    sampling: dict[str, Any] | None = None,
    threshold: float = 1.0,
) -> dict[str, Any]:
    """Top-level entry. `judges_spec` is a list of
    `{providerCredentialId, model}` entries. `filter_spec` may contain
    `verdict`, `topPercent`, `minAxisScore`, `conversationIds` (any
    combination). Updates BenchmarkResult rows in place and returns a
    summary (count processed, total tokens, total cost, flagged count).
    """
    if not judges_spec:
        return {"ok": False, "error": "no judges supplied"}

    # Resolve provider credentials once.
    judges_resolved: list[tuple[dict[str, Any], str]] = []
    for spec in judges_spec:
        pid = spec.get("providerCredentialId")
        if not pid:
            continue
        model = spec.get("model")
        if not isinstance(model, str) or not model:
            continue
        provider = await _load_judge_provider(pid)
        if not provider:
            log.warning("ensemble: judge provider %s not found, skipping", pid)
            continue
        judges_resolved.append((provider, model))
    if not judges_resolved:
        return {"ok": False, "error": "no resolvable judges"}

    # Run config — we still need the rubric to drive scoring.
    run_row = await db.fetch_one(
        '''SELECT br."rubricId", r.axes
           FROM "BenchmarkRun" br
           LEFT JOIN "Rubric" r ON r.id = br."rubricId"
           WHERE br.id = $1''',
        run_id,
    )
    if not run_row or not run_row["axes"]:
        return {"ok": False, "error": "run has no rubric"}
    rubric_axes = _parse_jsonb(run_row["axes"]) or []

    rows = await _select_rows(
        run_id,
        rubric_axes,
        conversation_ids=filter_spec.get("conversationIds"),
        verdict=filter_spec.get("verdict"),
        min_axis_score=filter_spec.get("minAxisScore"),
        top_percent=filter_spec.get("topPercent"),
    )
    if not rows:
        return {"ok": True, "processed": 0, "tokensIn": 0, "tokensOut": 0, "costUsd": 0.0, "flagged": 0}

    sampling = sampling or {}
    total_in = 0
    total_out = 0
    total_cost = 0.0
    flagged = 0
    for row in rows:
        # Reconstruct what the judge needs: reference + candidate
        # messages and the system / first user text.
        ref_msgs_raw = _parse_jsonb(row["referenceMessages"]) or []
        cand_msgs_raw = _parse_jsonb(row["candidateMessages"]) or []
        # Pull system + first user out of ref_msgs for the judge prompt.
        system_text = ""
        first_user = ""
        ref_for_judge: list[dict[str, Any]] = []
        for m in ref_msgs_raw if isinstance(ref_msgs_raw, list) else []:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            if role == "system":
                system_text = m.get("content") or ""
                ref_for_judge.append({"role": "system", "content": system_text})
            elif role == "user":
                if not first_user:
                    first_user = m.get("content") or ""
                ref_for_judge.append({"role": "user", "content": m.get("content") or ""})
            elif role == "assistant":
                ref_for_judge.append({
                    "role": "assistant",
                    "content": m.get("content") or "",
                    **({"tool_calls": m.get("toolCalls") or m.get("tool_calls")}
                       if (m.get("toolCalls") or m.get("tool_calls")) else {}),
                })
            elif role == "tool":
                ref_for_judge.append({
                    "role": "tool",
                    "content": m.get("content") or "",
                })

        cand_for_judge: list[dict[str, Any]] = []
        for m in cand_msgs_raw if isinstance(cand_msgs_raw, list) else []:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            if role not in ("assistant", "tool"):
                continue
            entry: dict[str, Any] = {"role": role, "content": m.get("content") or ""}
            tc = m.get("tool_calls") or m.get("toolCalls")
            if tc:
                entry["tool_calls"] = tc
            cand_for_judge.append(entry)

        # Run each judge sequentially (each one already retries
        # internally). Could parallelize but rate limits make
        # sequential the safer default.
        judge_results: list[dict[str, Any]] = []
        for provider, model in judges_resolved:
            try:
                jr = await _run_one_judge(
                    judge=provider,
                    model=model,
                    rubric_axes=rubric_axes,
                    system_text=system_text,
                    user_text=first_user,
                    reference_messages=ref_for_judge,
                    candidate_messages=cand_for_judge,
                    sampling=sampling,
                )
            except Exception as e:  # noqa: BLE001
                log.warning("ensemble judge %s/%s failed for row %s: %s",
                            provider["name"], model, row["id"], e)
                continue
            judge_results.append(jr)
            total_in += jr["tokensIn"]
            total_out += jr["tokensOut"]
            total_cost += jr["costUsd"]

        if not judge_results:
            continue

        agg = _aggregate(judge_results, rubric_axes)
        if agg["maxDisagreement"] > threshold:
            flagged += 1
        ensemble_payload = {
            "judges": judge_results,
            "medianScores": agg["medianScores"],
            "worstVerdict": agg["worstVerdict"],
            "maxDisagreement": agg["maxDisagreement"],
            "threshold": threshold,
            "ensembledAt": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        }
        await db.execute(
            '''UPDATE "BenchmarkResult"
               SET "ensembleResult" = $2::jsonb,
                   "ensembledAt"    = NOW()
               WHERE id = $1''',
            row["id"],
            json.dumps(ensemble_payload),
        )

    return {
        "ok": True,
        "processed": len(rows),
        "tokensIn": total_in,
        "tokensOut": total_out,
        "costUsd": round(total_cost, 6),
        "flagged": flagged,
        "judgeCount": len(judges_resolved),
    }
