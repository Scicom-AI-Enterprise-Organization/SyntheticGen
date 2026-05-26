"""Chat-replay benchmarking.

Replays project-generated conversations against a candidate model and scores
each replay with:
  1. Deterministic validators (lang-ID, register, ngram-repetition) — same code
     path as generation, so the candidate's output is graded on the same axes
     the project already cares about.
  2. Function-call comparison: if the reference assistant turn issued
     tool_calls, compare against the candidate's tool_calls turn-by-turn using
     `evaluate_multiple_tool_calls` (same scorer as the HF function-call path).
  3. LLM-as-judge: a strong-model judge scores the candidate against the
     reference on the user-defined Rubric axes.

Persists one BenchmarkResult per conversation. Aggregates per-split (language)
+ overall metrics into BenchmarkRun.metrics.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from .. import db
from ..crypto import decrypt_secret
from ..providers import chat_completion, chat_completion_stream, estimate_cost
from ..validators import ValidatorContext, run_pipeline
from .judge import call_judge_streaming
from .scoring import aggregate_metrics as fc_aggregate, evaluate_multiple_tool_calls


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


async def _load_chat_replay_run(run_id: str) -> dict[str, Any] | None:
    """Load all the metadata needed to drive a chat-replay run.

    Joins BenchmarkRun → Benchmark → candidate ProviderCredential. Judge provider
    + rubric are loaded separately so we can return helpful errors if they're
    missing.
    """
    row = await db.fetch_one(
        """
        SELECT br.id, br."benchmarkId", br."providerCredentialId" AS candidate_provider_id,
               br.model AS candidate_model, br.status, br.mode,
               br."judgeProviderCredentialId" AS judge_provider_id, br."judgeModel" AS judge_model,
               br."ensembleGroupId" AS ensemble_group_id,
               br."consensusMethod" AS consensus_method,
               br."rubricId" AS rubric_id, br."samplingParams" AS sampling_params,
               b.kind AS benchmark_kind, b."frozenConversationIds" AS frozen_ids,
               b.config AS benchmark_config, b."projectId" AS project_id,
               cpc."baseUrl" AS cand_base_url, cpc."encryptedApiKey" AS cand_key,
               cpc.headers AS cand_headers, cpc."reasoningEffort" AS cand_reasoning,
               cpc."chatTemplateKwargs" AS cand_chat_template
        FROM "BenchmarkRun" br
        JOIN "Benchmark" b ON b.id = br."benchmarkId"
        JOIN "ProviderCredential" cpc ON cpc.id = br."providerCredentialId"
        WHERE br.id = $1
        """,
        run_id,
    )
    if not row:
        return None
    out = dict(row)
    # Build the list of judges this run scores against. Preference:
    #   1. ensembleGroupId set → fetch the group's judges JSON and hydrate
    #      each one with provider auth.
    #   2. Otherwise (legacy rows) → synthesise a single-judge list from
    #      judgeProviderCredentialId + judgeModel.
    # A group of 1 judge collapses to the old single-judge behaviour
    # — same code path, no special-casing.
    judges: list[dict[str, Any]] = []
    if out.get("ensemble_group_id"):
        grow = await db.fetch_one(
            'SELECT name, judges FROM "EnsembleJudgeGroup" WHERE id = $1',
            out["ensemble_group_id"],
        )
        if grow:
            out["ensemble_group_name"] = grow["name"]
            raw = _parse_jsonb(grow["judges"]) or []
            if isinstance(raw, list):
                for j in raw:
                    if not isinstance(j, dict):
                        continue
                    pid = j.get("providerCredentialId")
                    model = j.get("model")
                    if not pid or not model:
                        continue
                    jrow = await db.fetch_one(
                        """
                        SELECT name, kind, "baseUrl", "encryptedApiKey", headers,
                               "reasoningEffort", "chatTemplateKwargs"
                        FROM "ProviderCredential"
                        WHERE id = $1
                        """,
                        pid,
                    )
                    if not jrow:
                        continue
                    judges.append({
                        "provider_id": pid,
                        "provider_name": jrow["name"],
                        "provider_kind": jrow["kind"],
                        "base_url": jrow["baseUrl"],
                        "key": jrow["encryptedApiKey"],
                        "model": model,
                        "headers": jrow["headers"],
                        "reasoning": jrow["reasoningEffort"],
                        "chat_template": jrow["chatTemplateKwargs"],
                    })
    if not judges and out.get("judge_provider_id"):
        jrow = await db.fetch_one(
            """
            SELECT name, kind, "baseUrl", "encryptedApiKey", headers,
                   "reasoningEffort", "chatTemplateKwargs"
            FROM "ProviderCredential"
            WHERE id = $1
            """,
            out["judge_provider_id"],
        )
        if jrow:
            judges.append({
                "provider_id": out["judge_provider_id"],
                "provider_name": jrow["name"],
                "provider_kind": jrow["kind"],
                "base_url": jrow["baseUrl"],
                "key": jrow["encryptedApiKey"],
                "model": out["judge_model"],
                "headers": jrow["headers"],
                "reasoning": jrow["reasoningEffort"],
                "chat_template": jrow["chatTemplateKwargs"],
            })
            # Also keep the flat fields populated for legacy code paths
            # (calibration uses them).
            out["judge_base_url"] = jrow["baseUrl"]
            out["judge_key"] = jrow["encryptedApiKey"]
            out["judge_headers"] = jrow["headers"]
            out["judge_reasoning"] = jrow["reasoningEffort"]
            out["judge_chat_template"] = jrow["chatTemplateKwargs"]
    out["judges"] = judges
    if not out.get("consensus_method"):
        out["consensus_method"] = "median"
    if out["rubric_id"]:
        rrow = await db.fetch_one(
            'SELECT name, axes FROM "Rubric" WHERE id = $1',
            out["rubric_id"],
        )
        if rrow:
            out["rubric_name"] = rrow["name"]
            out["rubric_axes"] = _parse_jsonb(rrow["axes"]) or []
    return out


async def _load_conversation_bundle(conversation_id: str) -> dict[str, Any] | None:
    """Pull the messages + the resolved language profile / tools needed to
    replay a single conversation."""
    conv = await db.fetch_one(
        """
        SELECT c.id, c."primaryLanguage", c."primaryScript", c."runId", c.status,
               c.difficulty, gr."languageProfileId", gr.model AS reference_model,
               gr."configSnapshot" AS config_snapshot
        FROM "Conversation" c
        LEFT JOIN "GenerationRun" gr ON gr.id = c."runId"
        WHERE c.id = $1
        """,
        conversation_id,
    )
    if not conv:
        return None
    messages = await db.fetch_all(
        """
        SELECT ordinal, role, content, "toolCalls", "toolCallId", language, script
        FROM "Message"
        WHERE "conversationId" = $1
        ORDER BY ordinal ASC
        """,
        conversation_id,
    )

    lp_row = None
    if conv["languageProfileId"]:
        lp_row = await db.fetch_one(
            # `primary` is a Postgres reserved word — must be double-quoted.
            # The `requireFormalMalay` Prisma field maps to the `requireBahasaBaku`
            # column (see schema.prisma:308 — @map("requireBahasaBaku")).
            """
            SELECT "primary" AS primary, script, register, "allowParticles" AS "allowParticles",
                   "bannedTokens" AS "bannedTokens", "bannedPatterns" AS "bannedPatterns",
                   "requireBahasaBaku" AS "requireFormalMalay",
                   "englishLoanwordPolicy" AS "englishLoanwordPolicy",
                   "loanwordAllowlist" AS "loanwordAllowlist",
                   "codeSwitchPolicy" AS "codeSwitchPolicy",
                   "codeSwitchRate" AS "codeSwitchRate"
            FROM "LanguageProfile"
            WHERE id = $1
            """,
            conv["languageProfileId"],
        )

    # Resolve any tool definitions the run referenced (so the candidate sees the
    # same tools the reference saw).
    tools: list[dict[str, Any]] = []
    config_snap = _parse_jsonb(conv["config_snapshot"]) or {}
    tool_ids = config_snap.get("toolIds") if isinstance(config_snap, dict) else None
    if isinstance(tool_ids, list) and tool_ids:
        tool_rows = await db.fetch_all(
            'SELECT name, description, parameters FROM "ToolDef" WHERE id = ANY($1::text[])',
            tool_ids,
        )
        for t in tool_rows:
            params = _parse_jsonb(t["parameters"]) or {"type": "object", "properties": {}}
            tools.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"] or "",
                    "parameters": params,
                },
            })

    return {
        "conversation": dict(conv),
        "messages": [dict(m) for m in messages],
        "language_profile": dict(lp_row) if lp_row else None,
        "tools": tools,
    }


def _build_validator_ctx(lp: dict[str, Any] | None, fallback_lang: str | None) -> ValidatorContext:
    """Construct a ValidatorContext from a LanguageProfile row (or sensible defaults)."""
    if not lp:
        return ValidatorContext(
            primary_language=fallback_lang or "ms",
            script="latin",
            register="mixed",
            allow_particles=True,
            banned_tokens=[],
            banned_patterns=[],
            require_formal_malay=False,
            english_loanword_policy="free",
            loanword_allowlist=[],
            code_switch_policy="none",
            code_switch_rate=None,
        )
    return ValidatorContext(
        primary_language=lp.get("primary") or fallback_lang or "ms",
        script=lp.get("script") or "latin",
        register=lp.get("register") or "mixed",
        allow_particles=bool(lp.get("allowParticles")),
        banned_tokens=list(lp.get("bannedTokens") or []),
        banned_patterns=list(lp.get("bannedPatterns") or []),
        require_formal_malay=bool(lp.get("requireFormalMalay")),
        english_loanword_policy=lp.get("englishLoanwordPolicy") or "free",
        loanword_allowlist=list(lp.get("loanwordAllowlist") or []),
        code_switch_policy=lp.get("codeSwitchPolicy") or "none",
        code_switch_rate=lp.get("codeSwitchRate"),
    )


def _normalise_tool_calls(raw: Any) -> list[dict[str, Any]]:
    """Map various tool_call shapes (DB row, OpenAI response) into the
    {function: {name, arguments}} dict the scorer expects."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        fn = c.get("function") if isinstance(c.get("function"), dict) else c
        name = fn.get("name") if isinstance(fn, dict) else None
        args = fn.get("arguments") if isinstance(fn, dict) else c.get("arguments")
        if isinstance(args, (dict, list)):
            args = json.dumps(args, ensure_ascii=False)
        elif args is None:
            args = "{}"
        elif not isinstance(args, str):
            args = str(args)
        if name:
            out.append({"function": {"name": name, "arguments": args}})
    return out


def _strip_for_replay(msg: dict[str, Any]) -> dict[str, Any]:
    """Reduce a stored Message row to the OpenAI chat shape the candidate sees."""
    out: dict[str, Any] = {"role": msg.get("role"), "content": msg.get("content") or ""}
    tc = _normalise_tool_calls(msg.get("toolCalls"))
    if tc:
        out["tool_calls"] = tc
    if msg.get("toolCallId"):
        out["tool_call_id"] = msg["toolCallId"]
    return out


async def _set_status(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    # Columns that are JSONB on BenchmarkRun — these need an explicit
    # `::jsonb` cast so the JSON-encoded string we pass is parsed as a
    # real JSON value, not stored as a quoted JSON string. (Same bug
    # class as the BenchmarkResult validatorScores rendering.)
    jsonb_columns = {"metrics", "samplingParams", "calibrationReport"}
    clauses = []
    values: list[Any] = []
    for i, (k, v) in enumerate(fields.items(), start=2):
        cast = "::jsonb" if k in jsonb_columns else ""
        clauses.append(f'"{k}" = ${i}{cast}')
        values.append(v)
    clauses.append('"updatedAt" = NOW()')
    sql = f'UPDATE "BenchmarkRun" SET {", ".join(clauses)} WHERE id = $1'
    await db.execute(sql, run_id, *values)


async def _check_cancelled(run_id: str) -> bool:
    row = await db.fetch_one('SELECT status FROM "BenchmarkRun" WHERE id = $1', run_id)
    return bool(row and row["status"] == "cancelled")


def _now() -> Any:
    # BenchmarkRun timestamp columns are `timestamp without time zone`, so
    # asyncpg refuses tz-aware datetimes. Compute UTC, drop the tzinfo.
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(tzinfo=None)


class _StreamResult:
    """Mirrors ChatResult's surface so the caller doesn't have to special-case
    streaming vs non-streaming. Populated by `_run_candidate_streaming`."""

    __slots__ = (
        "content",
        "tool_calls",
        "tokens_in",
        "tokens_out",
        "cost_usd",
    )

    def __init__(self) -> None:
        self.content: str = ""
        self.tool_calls: list[dict[str, Any]] | None = None
        self.tokens_in: int = 0
        self.tokens_out: int = 0
        self.cost_usd: float = 0.0


async def _run_candidate_streaming(
    run_id: str,
    *,
    row_idx: int,
    turn_num: int,
    candidate_base: str,
    candidate_key: str,
    candidate_model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    sampling: dict[str, Any],
    candidate_headers: Any,
    candidate_reasoning: str | None,
    candidate_chat_template: Any,
) -> _StreamResult:
    """Stream the candidate's reply and pg_notify every content delta so
    the Live Benchmark Preview UI can show tokens arriving in real time.
    Falls back gracefully if the stream errors mid-way."""
    out = _StreamResult()
    full_parts: list[str] = []
    tool_calls: list[dict[str, Any]] | None = None
    try:
        async for ev in chat_completion_stream(
            base_url=candidate_base,
            api_key=candidate_key,
            model=candidate_model,
            messages=messages,
            tools=tools,
            temperature=float(sampling.get("temperature", 0.7)),
            top_p=float(sampling.get("top_p", 1.0)),
            max_tokens=int(sampling.get("max_tokens", 4096)),
            seed=sampling.get("seed"),
            extra_headers=candidate_headers if isinstance(candidate_headers, dict) else None,
            reasoning_effort=candidate_reasoning,
            chat_template_kwargs=candidate_chat_template if isinstance(candidate_chat_template, dict) else None,
        ):
            if ev.error:
                continue
            if ev.done:
                out.tokens_in = ev.tokens_in
                out.tokens_out = ev.tokens_out
                out.cost_usd = estimate_cost(candidate_model, ev.tokens_in, ev.tokens_out)
                out.content = ev.full_text or "".join(full_parts)
                tool_calls = ev.tool_calls
                break
            if ev.delta:
                # Skip reasoning deltas in the user-facing stream — they're
                # noisy and the UI only cares about visible answer tokens.
                if not ev.reasoning:
                    full_parts.append(ev.delta)
                    await _notify(run_id, {
                        "event": "candidate.delta",
                        "index": row_idx,
                        "turn": turn_num,
                        "text": ev.delta,
                    })
    except Exception as e:  # noqa: BLE001
        log.warning("candidate stream failed for run=%s row=%s: %s", run_id, row_idx, e)
        if not out.content:
            out.content = "".join(full_parts)
    out.tool_calls = tool_calls
    if not out.content:
        out.content = "".join(full_parts)
    return out


def _build_metrics(
    *,
    per_split_judge: dict[str, list[dict[str, Any]]],
    per_split_validators: dict[str, list[dict[str, Any]]],
    per_split_fc: dict[str, list[dict[str, Any]]],
    rubric_axes: list[dict[str, Any]],
    completed: int,
    failed: int,
    total_tokens_in: int,
    total_tokens_out: int,
    total_cost: float,
) -> dict[str, Any]:
    """Compose the metrics blob the Metrics panel reads. Shared between
    in-flight incremental writes (every 5 items) and the final rollup so
    the shape is identical and the UI doesn't have to special-case
    partial state."""
    splits = set(per_split_judge) | set(per_split_validators) | set(per_split_fc)
    return {
        "kind": "chat-replay",
        "splits": {
            split: {
                "axes": _rollup_axes(per_split_judge.get(split, []), rubric_axes),
                "validators": _rollup_validators(per_split_validators.get(split, [])),
                "functionCall": fc_aggregate(per_split_fc.get(split, []))
                if per_split_fc.get(split)
                else None,
                "verdictCounts": _verdict_counts(per_split_judge.get(split, [])),
                "totalItems": len(per_split_judge.get(split, [])),
            }
            for split in splits
        },
        "overall": {
            "axes": _rollup_axes(
                [v for vs in per_split_judge.values() for v in vs], rubric_axes
            ),
            "validators": _rollup_validators(
                [v for vs in per_split_validators.values() for v in vs]
            ),
            "functionCall": fc_aggregate(
                [v for vs in per_split_fc.values() for v in vs]
            )
            if any(per_split_fc.values())
            else None,
            "verdictCounts": _verdict_counts(
                [v for vs in per_split_judge.values() for v in vs]
            ),
            "totalItems": completed,
            "failedItems": failed,
            "tokensIn": total_tokens_in,
            "tokensOut": total_tokens_out,
            "costUsd": round(total_cost, 6),
        },
    }


async def _run_calibration(
    *,
    run_id: str,
    project_id: str,
    rubric_axes: list[dict[str, Any]],
    judge_base: str,
    judge_key: str,
    judge_model: str,
    judge_headers: Any,
    judge_reasoning: str | None,
    judge_chat_template: Any,
    sampling: dict[str, Any],
) -> dict[str, Any] | None:
    """Re-judge every calibration item in this project and compare the
    judge's scores to the hand-rated baseline (`Conversation.calibrationExpected`).
    Returns the drift report dict, or None if no calibration items exist.

    Drift threshold defaults to 1 point on the axis scale (e.g. 1/5 on a
    5-pt scale). Override via samplingParams.calibration_drift_threshold.
    """
    if not project_id:
        return None
    rows = await db.fetch_all(
        '''SELECT id, "calibrationExpected" FROM "Conversation"
           WHERE "projectId" = $1 AND "isCalibration" = TRUE
           ORDER BY "createdAt" ASC
           LIMIT 100''',
        project_id,
    )
    if not rows:
        return None

    threshold = float(sampling.get("calibration_drift_threshold", 1.0))
    item_reports: list[dict[str, Any]] = []
    max_delta_overall = 0.0
    total_delta = 0.0
    delta_count = 0

    for r in rows:
        conv_id = r["id"]
        expected = _parse_jsonb(r.get("calibrationExpected")) or {}
        if not isinstance(expected, dict) or not expected:
            continue

        bundle = await _load_conversation_bundle(conv_id)
        if not bundle:
            continue
        messages = bundle["messages"]
        system_msg = next((m for m in messages if m.get("role") == "system"), None)
        system_text = (system_msg.get("content") if system_msg else "") or ""
        user_msgs = [m for m in messages if m.get("role") == "user"]
        reference_assistants = [m for m in messages if m.get("role") == "assistant"]
        if not user_msgs or not reference_assistants:
            continue

        # Score the whole conversation in one shot — calibration doesn't
        # need per-turn breakdown.
        first_user_text = user_msgs[0].get("content") or ""
        cand_messages = [
            {
                "role": "assistant",
                "content": m.get("content") or "",
                **(
                    {"tool_calls": _normalise_tool_calls(m.get("toolCalls"))}
                    if m.get("toolCalls") else {}
                ),
            }
            for m in reference_assistants
        ]
        ref_messages = [{"role": "system", "content": system_text}] if system_text else []
        for u in user_msgs:
            ref_messages.append({"role": "user", "content": u.get("content") or ""})
        try:
            jr = await call_judge_streaming(
                base_url=judge_base,
                api_key=judge_key,
                model=judge_model,
                rubric_axes=rubric_axes,
                system_text=system_text,
                user_text=first_user_text,
                reference_messages=ref_messages,
                candidate_messages=cand_messages,
                extra_headers=judge_headers if isinstance(judge_headers, dict) else None,
                reasoning_effort=judge_reasoning,
                chat_template_kwargs=judge_chat_template if isinstance(judge_chat_template, dict) else None,
                temperature=sampling.get("judge_temperature"),
                max_tokens=sampling.get("judge_max_tokens"),
                max_retries=int(sampling.get("judge_max_retries", 3) or 3),
                on_delta=None,
            )
        except Exception:  # noqa: BLE001
            log.exception("calibration judge failed for conv %s", conv_id)
            continue

        actual = jr.get("scores") or {}
        delta: dict[str, float] = {}
        item_max = 0.0
        for axis_key, exp_val in expected.items():
            if not isinstance(exp_val, (int, float)):
                continue
            act_val = actual.get(axis_key)
            if not isinstance(act_val, (int, float)):
                continue
            d = abs(float(act_val) - float(exp_val))
            delta[axis_key] = d
            if d > item_max:
                item_max = d
            total_delta += d
            delta_count += 1

        item_reports.append({
            "conversationId": conv_id,
            "expected": expected,
            "actual": actual,
            "delta": delta,
            "maxDelta": item_max,
        })
        max_delta_overall = max(max_delta_overall, item_max)

    if not item_reports:
        return None
    mean_delta = total_delta / delta_count if delta_count else 0.0
    return {
        "items": item_reports,
        "maxDelta": max_delta_overall,
        "meanDelta": mean_delta,
        "driftFlagged": max_delta_overall > threshold,
        "threshold": threshold,
    }


async def _notify(run_id: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget pg_notify on the synthgen_benchmark channel.

    The Next.js SSE route LISTENs on this channel and forwards matching
    runId events to the Live Benchmark Preview UI so users can watch a
    long replay in real time instead of waiting for the page to update on
    next reload.

    Best-effort: failures are swallowed so a transient db hiccup never
    breaks the replay itself. Payload must include `runId`; we patch it
    in for the caller so they can't forget.
    """
    import json as _json

    payload = {**payload, "runId": run_id}
    try:
        await db.execute("SELECT pg_notify('synthgen_benchmark', $1)", _json.dumps(payload))
    except Exception:  # noqa: BLE001
        log.warning("benchmark pg_notify failed for run %s", run_id, exc_info=False)


async def execute_chat_replay_run(run_id: str) -> None:
    """Top-level entry for chat-replay benchmarks. Idempotent.

    Walks Benchmark.frozenConversationIds; for each conversation, replays the
    user-side script through the candidate model and scores against the
    reference assistant turns with validators + LLM judge.
    """
    run = await _load_chat_replay_run(run_id)
    if not run:
        log.error("chat-replay run not found: %s", run_id)
        return
    if run["status"] in {"completed", "cancelled"}:
        return

    rubric_axes = run.get("rubric_axes") or []
    if not rubric_axes:
        await _set_status(
            run_id,
            status="failed",
            lastError="No rubric — chat-replay needs a rubric attached to the run or benchmark.",
            completedAt=_now(),
        )
        return
    judges = run.get("judges") or []
    if not judges:
        await _set_status(
            run_id,
            status="failed",
            lastError=(
                "No judges configured for this run. Either set an "
                "ensembleGroupId with ≥1 judge, or (legacy) populate "
                "judgeProviderCredentialId + judgeModel."
            ),
            completedAt=_now(),
        )
        return
    consensus_method = run.get("consensus_method") or "median"

    frozen_ids = run["frozen_ids"] or []
    if not frozen_ids:
        await _set_status(
            run_id,
            status="failed",
            lastError="Benchmark has no frozen conversations — nothing to replay.",
            completedAt=_now(),
        )
        return

    candidate_key = decrypt_secret(run["cand_key"])
    cand_headers = _parse_jsonb(run.get("cand_headers"))
    cand_chat_template = _parse_jsonb(run.get("cand_chat_template"))
    sampling = _parse_jsonb(run.get("sampling_params")) or {}
    mode = run.get("mode") or "multi-turn"

    # Decrypt every judge's API key + parse JSONB columns up-front so the
    # per-item loop just reads them. Each judge in the list has the same
    # shape as the (legacy) single-judge config used to.
    prepared_judges: list[dict[str, Any]] = []
    for j in judges:
        prepared_judges.append({
            "provider_id": j["provider_id"],
            "provider_name": j.get("provider_name"),
            "provider_kind": j.get("provider_kind"),
            "base_url": j["base_url"] or "",
            "key": decrypt_secret(j["key"]) if j.get("key") else "",
            "model": j["model"],
            "headers": _parse_jsonb(j.get("headers")),
            "reasoning": j.get("reasoning"),
            "chat_template": _parse_jsonb(j.get("chat_template")),
        })

    await _set_status(run_id, status="running", startedAt=_now(), totalTurns=len(frozen_ids))
    await _notify(run_id, {
        "event": "run.start",
        "total": len(frozen_ids),
        "candidateModel": run.get("candidate_model"),
        "judgeModel": prepared_judges[0]["model"] if prepared_judges else None,
        "judges": [
            {"providerName": j["provider_name"], "providerKind": j["provider_kind"], "model": j["model"]}
            for j in prepared_judges
        ],
        "consensusMethod": consensus_method,
        "mode": mode,
    })

    # ─── Calibration drift check ───────────────────────────────────────
    # Fetch any conversations marked isCalibration=true for this project
    # and re-judge them. Compare the judge's scores to the expected
    # baseline. If they drift beyond the threshold, flag the run.
    # Calibration items are judged BEFORE the main loop so the user
    # sees the warning early — and so a known-drifting judge doesn't
    # waste hours of compute on results we can't trust.
    project_id = run.get("project_id")
    candidate_key_dec = decrypt_secret(run["cand_key"]) if run.get("cand_key") else ""
    # Calibration always uses the first judge in the ensemble — the goal
    # is a cheap drift check, not consensus. If a multi-judge group is
    # picked, the first judge is the proxy.
    cal_judge = prepared_judges[0]
    try:
        calibration_report = await _run_calibration(
            run_id=run_id,
            project_id=project_id,
            rubric_axes=rubric_axes,
            judge_base=cal_judge["base_url"],
            judge_key=cal_judge["key"],
            judge_model=cal_judge["model"],
            judge_headers=cal_judge["headers"],
            judge_reasoning=cal_judge["reasoning"],
            judge_chat_template=cal_judge["chat_template"],
            sampling=sampling,
        )
        if calibration_report is not None:
            await _set_status(run_id, calibrationReport=json.dumps(calibration_report))
            await _notify(run_id, {
                "event": "calibration.report",
                **calibration_report,
            })
    except Exception:  # noqa: BLE001
        log.exception("calibration drift check failed for run %s", run_id)

    # Per-split (language) buckets for aggregation. Splits are derived from the
    # reference conversation's primaryLanguage so reporting groups by language.
    per_split_judge: dict[str, list[dict[str, Any]]] = defaultdict(list)
    per_split_validators: dict[str, list[dict[str, Any]]] = defaultdict(list)
    per_split_fc: dict[str, list[dict[str, Any]]] = defaultdict(list)

    completed = 0
    failed = 0
    total_tokens_in = 0
    total_tokens_out = 0
    total_cost = 0.0

    # Resumable runs: load every row_idx already judged for this run so
    # we don't double-judge after a crash/restart. The benchmark cancel
    # button now intentionally LEAVES BenchmarkResult rows in place, so
    # a later restart picks up exactly where the last attempt stopped.
    # `kind='chat-replay'` is the conversation-level row written per
    # item — per-turn rows have the same rowIdx but kind='chat-replay-
    # turn'. Filtering to chat-replay covers both modes correctly.
    existing_rows = await db.fetch_all(
        'SELECT "rowIdx" FROM "BenchmarkResult" WHERE "runId" = $1 AND kind = $2',
        run_id,
        "chat-replay",
    )
    already_done: set[int] = {int(r["rowIdx"]) for r in existing_rows}
    if already_done:
        completed = len(already_done)
        log.info(
            "chat-replay run %s resumable: %s rows already judged, will skip",
            run_id,
            len(already_done),
        )
        # Notify the UI right away so the tile row shows previously-
        # completed items as such instead of starting blank.
        await _notify(run_id, {
            "event": "snapshot",
            "status": "running",
            "completed": completed,
            "failed": failed,
            "total": len(frozen_ids),
        })

    # Parallelism — same model as conversation-generation jobs. Each
    # item is independent (separate frozen conversation + separate judge
    # call), so a semaphore-bounded gather lets the run finish K× faster.
    # samplingParams.concurrency overrides; default 4. asyncio is
    # single-threaded so the shared `per_split_*` dict updates and
    # counter increments are safe without locks.
    concurrency = max(1, int(sampling.get("concurrency", 4)))
    semaphore = asyncio.Semaphore(concurrency)

    cancelled = False
    completed_lock = asyncio.Lock()  # only used to serialize incremental rollup writes

    async def _process_one(row_idx: int, conv_id: str) -> None:
        nonlocal completed, failed, total_tokens_in, total_tokens_out, total_cost, cancelled
        # Skip rows already judged in a prior attempt of this run —
        # idempotent restart relies on this check.
        if row_idx in already_done:
            await _notify(run_id, {
                "event": "item.start",
                "index": row_idx,
                "total": len(frozen_ids),
                "conversationId": conv_id,
                "split": "resumed",
            })
            await _notify(run_id, {
                "event": "item.done",
                "index": row_idx,
                "conversationId": conv_id,
                "verdict": "pass",  # actual verdict re-rendered on page reload
                "split": "resumed",
                "completed": completed,
                "failed": failed,
                "total": len(frozen_ids),
                "tokensIn": 0,
                "tokensOut": 0,
                "candidatePreview": "(already scored — refresh the page to see the persisted row)",
                "rationalePreview": "",
            })
            return
        async with semaphore:
            if cancelled:
                return
            if await _check_cancelled(run_id):
                cancelled = True
                return
            bundle = await _load_conversation_bundle(conv_id)
            if not bundle:
                failed += 1
                await _notify(run_id, {
                    "event": "item.error",
                    "index": row_idx,
                    "conversationId": conv_id,
                    "error": "conversation bundle missing",
                })
                return
            await _notify(run_id, {
                "event": "item.start",
                "index": row_idx,
                "total": len(frozen_ids),
                "conversationId": conv_id,
                "split": bundle["conversation"].get("primaryLanguage") or "unknown",
            })

            try:
                item = await _replay_one(
                    run_id=run_id,
                    row_idx=row_idx,
                    bundle=bundle,
                    mode=mode,
                    sampling=sampling,
                    rubric_axes=rubric_axes,
                    candidate_base=run["cand_base_url"],
                    candidate_key=candidate_key,
                    candidate_model=run["candidate_model"],
                    candidate_headers=cand_headers,
                    candidate_reasoning=run.get("cand_reasoning"),
                    candidate_chat_template=cand_chat_template,
                    judges=prepared_judges,
                    consensus_method=consensus_method,
                )
            except Exception as e:
                log.exception("chat-replay item failed run=%s conv=%s", run_id, conv_id)
                failed += 1
                await _persist_failure(run_id, row_idx, conv_id, bundle, str(e))
                completed += 1
                await _notify(run_id, {
                    "event": "item.error",
                    "index": row_idx,
                    "conversationId": conv_id,
                    "error": str(e)[:300],
                    "completed": completed,
                    "failed": failed,
                    "total": len(frozen_ids),
                })
                if completed % 1 == 0:  # write metrics after every item so the UI updates promptly
                    async with completed_lock:
                        await _set_status(
                            run_id, completedTurns=completed, failedTurns=failed
                        )
                return

            split = item["split"]
            per_split_judge[split].append(item["judge"])
            if item["validator_rows"]:
                per_split_validators[split].extend(item["validator_rows"])
            if item["fc_rows"]:
                per_split_fc[split].extend(item["fc_rows"])

            total_tokens_in += item["tokens_in"]
            total_tokens_out += item["tokens_out"]
            total_cost += item["cost_usd"]
            completed += 1
            await _notify(run_id, {
                "event": "item.done",
                "index": row_idx,
                "conversationId": conv_id,
                "verdict": item.get("judge", {}).get("verdict"),
                "split": split,
                "tokensIn": item["tokens_in"],
                "tokensOut": item["tokens_out"],
                "completed": completed,
                "failed": failed,
                "total": len(frozen_ids),
                "candidatePreview": (
                    (item.get("candidate_outputs") or [{}])[-1].get("content", "")[:600]
                    if item.get("candidate_outputs")
                    else None
                ),
                "rationalePreview": (
                    (item.get("judge") or {}).get("rationale", "") or ""
                )[:600],
            })
            if completed % 1 == 0:  # write metrics after every item so the UI updates promptly
                # Incremental metrics rollup so the Metrics panel shows
                # live axis means / verdict counts during the run, not
                # only at the end. Same shape as the final rollup below
                # so the UI doesn't have to special-case the in-flight
                # version. Serialized across concurrent items so two
                # workers don't trample the same UPDATE.
                async with completed_lock:
                    live_metrics = _build_metrics(
                        per_split_judge=per_split_judge,
                        per_split_validators=per_split_validators,
                        per_split_fc=per_split_fc,
                        rubric_axes=rubric_axes,
                        completed=completed,
                        failed=failed,
                        total_tokens_in=total_tokens_in,
                        total_tokens_out=total_tokens_out,
                        total_cost=total_cost,
                    )
                    await _set_status(
                        run_id,
                        completedTurns=completed,
                        failedTurns=failed,
                        tokensIn=total_tokens_in,
                        tokensOut=total_tokens_out,
                        costUsd=round(total_cost, 6),
                        metrics=json.dumps(live_metrics),
                    )

    try:
        await asyncio.gather(
            *[_process_one(i, cid) for i, cid in enumerate(frozen_ids)]
        )
        if cancelled:
            log.info("chat-replay run %s cancelled — stopping", run_id)
            return

        metrics = _build_metrics(
            per_split_judge=per_split_judge,
            per_split_validators=per_split_validators,
            per_split_fc=per_split_fc,
            rubric_axes=rubric_axes,
            completed=completed,
            failed=failed,
            total_tokens_in=total_tokens_in,
            total_tokens_out=total_tokens_out,
            total_cost=total_cost,
        )

        await _set_status(
            run_id,
            status="completed",
            completedTurns=completed,
            failedTurns=failed,
            tokensIn=total_tokens_in,
            tokensOut=total_tokens_out,
            costUsd=round(total_cost, 6),
            metrics=json.dumps(metrics),
            completedAt=_now(),
        )
        await _notify(run_id, {
            "event": "run.done",
            "status": "completed",
            "completed": completed,
            "failed": failed,
            "total": len(frozen_ids),
            "tokensIn": total_tokens_in,
            "tokensOut": total_tokens_out,
        })
        log.info(
            "chat-replay run %s complete — %s items, %s failed", run_id, completed, failed
        )
    except Exception as e:
        log.exception("chat-replay run %s crashed", run_id)
        await _set_status(
            run_id,
            status="failed",
            lastError=str(e)[:1000],
            completedTurns=completed,
            failedTurns=failed,
            completedAt=_now(),
        )
        await _notify(run_id, {
            "event": "run.done",
            "status": "failed",
            "error": str(e)[:300],
            "completed": completed,
            "failed": failed,
            "total": len(frozen_ids),
        })


def _aggregate_per_axis(values: list[float], method: str) -> float:
    """Aggregate one axis's per-judge scores into a consensus value.

    Methods:
      median (default) — robust to one outlier judge
      mean             — average of all judges' scores
      min              — strictest judge wins
    """
    if not values:
        return 0.0
    if method == "mean":
        return sum(values) / len(values)
    if method == "min":
        return min(values)
    # median (default). For an even-N list we take the lower-median so
    # the consensus tracks the stricter half — matches the "be strict"
    # framing of the rubric.
    s = sorted(values)
    return s[(len(s) - 1) // 2]


_VERDICT_ORDER = {"pass": 0, "warn": 1, "fail": 2}


def _worst_verdict(verdicts: list[str]) -> str:
    worst = "pass"
    for v in verdicts:
        if _VERDICT_ORDER.get(v, 0) > _VERDICT_ORDER.get(worst, 0):
            worst = v
    return worst


async def _call_consensus_judge(
    *,
    judges: list[dict[str, Any]],
    consensus_method: str,
    rubric_axes: list[dict[str, Any]],
    system_text: str,
    user_text: str,
    reference_messages: list[dict[str, Any]],
    candidate_messages: list[dict[str, Any]],
    sampling: dict[str, Any],
    on_delta,
) -> dict[str, Any]:
    """Call every judge in the ensemble sequentially and aggregate.

    Returns the same shape as the single-judge call PLUS an
    `ensemble` block describing the per-judge breakdown + disagreement.
    A list of 1 judge produces an `ensemble` of size 1; the consensus
    scores match that judge's raw scores exactly.
    """
    per_judge: list[dict[str, Any]] = []
    total_in = 0
    total_out = 0
    total_cost = 0.0
    for idx, j in enumerate(judges):
        # Tag streamed deltas with the judge's index so the UI can
        # distinguish per-judge streams (judge 1 of N, etc).
        async def _tagged_delta(text: str, _idx=idx, _name=j.get("provider_name"), _model=j.get("model")) -> None:
            if on_delta is None:
                return
            await on_delta(text, _idx, _name, _model)

        jr = await call_judge_streaming(
            base_url=j["base_url"],
            api_key=j["key"],
            model=j["model"],
            rubric_axes=rubric_axes,
            system_text=system_text,
            user_text=user_text,
            reference_messages=reference_messages,
            candidate_messages=candidate_messages,
            extra_headers=j["headers"] if isinstance(j.get("headers"), dict) else None,
            reasoning_effort=j.get("reasoning"),
            chat_template_kwargs=j["chat_template"] if isinstance(j.get("chat_template"), dict) else None,
            temperature=sampling.get("judge_temperature"),
            max_tokens=sampling.get("judge_max_tokens"),
            max_retries=int(sampling.get("judge_max_retries", 3) or 3),
            on_delta=_tagged_delta,
        )
        per_judge.append({
            "providerCredentialId": j.get("provider_id"),
            "providerName": j.get("provider_name"),
            "providerKind": j.get("provider_kind"),
            "model": j["model"],
            "scores": jr.get("scores") or {},
            "verdict": jr.get("verdict") or "fail",
            "rationale": jr.get("rationale") or "",
            "tokensIn": int(jr.get("tokens_in") or 0),
            "tokensOut": int(jr.get("tokens_out") or 0),
            "costUsd": float(jr.get("cost_usd") or 0.0),
        })
        total_in += int(jr.get("tokens_in") or 0)
        total_out += int(jr.get("tokens_out") or 0)
        total_cost += float(jr.get("cost_usd") or 0.0)

    # Aggregate per axis. Use only axes that at least one judge scored.
    all_axis_keys: set[str] = set()
    for pj in per_judge:
        for k in (pj["scores"] or {}).keys():
            all_axis_keys.add(k)
    consensus_scores: dict[str, float] = {}
    disagreement: dict[str, float] = {}
    for k in all_axis_keys:
        vals: list[float] = []
        for pj in per_judge:
            v = (pj["scores"] or {}).get(k)
            if isinstance(v, (int, float)):
                vals.append(float(v))
        if not vals:
            continue
        consensus_scores[k] = _aggregate_per_axis(vals, consensus_method)
        disagreement[k] = max(vals) - min(vals)
    verdict = _worst_verdict([pj["verdict"] for pj in per_judge])
    # Concatenate rationales with provider/model labels so the user
    # sees who said what. For N=1 this is just the single rationale.
    rationale_parts: list[str] = []
    for pj in per_judge:
        head = f"### {pj['providerName']} · {pj['model']} (verdict: {pj['verdict']})"
        body = pj["rationale"] or "(no rationale returned)"
        rationale_parts.append(f"{head}\n\n{body}")
    rationale = "\n\n— next judge —\n\n".join(rationale_parts)
    return {
        "scores": consensus_scores,
        "verdict": verdict,
        "rationale": rationale,
        "tokens_in": total_in,
        "tokens_out": total_out,
        "cost_usd": total_cost,
        "ensemble": {
            "method": consensus_method,
            "perJudge": per_judge,
            "disagreement": disagreement,
            "maxDisagreement": max(disagreement.values()) if disagreement else 0.0,
        },
    }


async def _replay_one(
    *,
    run_id: str,
    row_idx: int,
    bundle: dict[str, Any],
    mode: str,
    sampling: dict[str, Any],
    rubric_axes: list[dict[str, Any]],
    candidate_base: str,
    candidate_key: str,
    candidate_model: str,
    candidate_headers: Any,
    candidate_reasoning: str | None,
    candidate_chat_template: Any,
    judges: list[dict[str, Any]],
    consensus_method: str,
) -> dict[str, Any]:
    """Replay a single conversation. Returns aggregated rollup inputs for this
    item and persists a BenchmarkResult row."""
    conv = bundle["conversation"]
    messages = bundle["messages"]
    lp = bundle["language_profile"]
    tools = bundle["tools"] or None

    split = conv.get("primaryLanguage") or "unknown"

    # Find the system message (if any) and partition assistant/user turns.
    system_msg = next((m for m in messages if m.get("role") == "system"), None)
    system_text = (system_msg.get("content") if system_msg else "") or ""
    user_msgs = [m for m in messages if m.get("role") == "user"]
    reference_assistants = [m for m in messages if m.get("role") == "assistant"]
    if not user_msgs:
        raise RuntimeError("no user message in reference conversation")

    candidate_outputs: list[dict[str, Any]] = []
    fc_rows: list[dict[str, Any]] = []
    tokens_in = 0
    tokens_out = 0
    cost_usd = 0.0

    # Build turn blocks. A single "user turn" can produce MULTIPLE
    # reference messages downstream (e.g. tool_call assistant + tool
    # result + follow-up assistant text), so we group them by user
    # message position. Each block contains the user message and every
    # assistant/tool message that follows up to the next user.
    #
    # The previous index-based pairing (`reference_assistants[user_idx-1]`)
    # mis-aligned tool-heavy conversations because each tool call counted
    # as a separate assistant message, shifting subsequent turns by one.
    turn_blocks: list[dict[str, Any]] = []
    cur_block: dict[str, Any] | None = None
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        if role == "user":
            if cur_block is not None:
                turn_blocks.append(cur_block)
            cur_block = {"user": m, "messages": []}
        elif cur_block is not None and role in ("assistant", "tool"):
            cur_block["messages"].append(m)
    if cur_block is not None:
        turn_blocks.append(cur_block)

    # Walk turns: for multi-turn we feed each recorded user turn in order;
    # for single-turn we stop after the first.
    context: list[dict[str, Any]] = []
    if system_msg:
        context.append({"role": "system", "content": system_text})

    # Judge-only mode: we no longer re-invoke a candidate model. Instead we
    # treat the existing reference assistant turns as the "candidate"
    # outputs the judge scores. This keeps tools / context / persona
    # consistent with whatever produced the dataset and avoids the
    # combinatorial mess of plumbing tool catalogs into a second model.
    #
    # Pairing: per recorded user message, take the matching reference
    # assistant turn (by 1:1 ordinal among user→assistant pairs). For
    # multi-turn we walk every pair; for single-turn we stop after the
    # first.
    # Iterate turn BLOCKS (one per user message + its downstream
    # assistant/tool messages). Each block becomes one logical "turn"
    # the judge scores. Each message we append to candidate_outputs is
    # tagged with `_turn` so the UI can group flat messages back into
    # their turn blocks (rationales are also indexed per turn — without
    # the tag the UI would zip them 1:1 by array position and orphan
    # the rationales for tool-heavy turns).
    user_idx = 0
    turn_num = 0
    for block in turn_blocks:
        user_idx += 1
        turn_num += 1
        # Render every assistant/tool message in the block into a
        # display string AND into candidate_outputs (for the judge).
        display_parts: list[str] = []
        for m in block["messages"]:
            role = m.get("role")
            if role == "assistant":
                text = m.get("content") or ""
                tc = _normalise_tool_calls(m.get("toolCalls"))
                cand_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": text,
                    "_turn": turn_num,
                }
                if tc:
                    cand_msg["tool_calls"] = tc
                candidate_outputs.append(cand_msg)
                if text:
                    display_parts.append(text)
                if tc:
                    for t in tc[:3]:
                        fn = (t.get("function") or {}) if isinstance(t, dict) else {}
                        name = fn.get("name") or "?"
                        args = fn.get("arguments") or ""
                        if isinstance(args, str) and len(args) > 200:
                            args = args[:200] + "…"
                        display_parts.append(f"[tool_call] {name}({args})")
                    if len(tc) > 3:
                        display_parts.append(f"[…and {len(tc) - 3} more tool_call(s)]")
            elif role == "tool":
                tool_content = m.get("content") or ""
                cand_msg2: dict[str, Any] = {
                    "role": "tool",
                    "content": tool_content,
                    "_turn": turn_num,
                }
                tool_call_id = m.get("toolCallId")
                if tool_call_id:
                    cand_msg2["tool_call_id"] = tool_call_id
                candidate_outputs.append(cand_msg2)
                preview = tool_content.replace("\n", " ")
                if len(preview) > 200:
                    preview = preview[:200] + "…"
                display_parts.append(f"[tool_result] {preview}")

        display_text = "\n\n".join(display_parts) if display_parts else "(empty turn — no assistant reply)"
        await _notify(run_id, {
            "event": "candidate.replay",
            "index": row_idx,
            "turn": turn_num,
            "text": display_text,
        })

        if mode == "single-turn":
            break

    # Validators on the *last* candidate assistant turn (most informative for
    # single-turn; for multi-turn, also informative as the closing answer).
    vctx = _build_validator_ctx(lp, fallback_lang=split)
    validator_rows: list[dict[str, Any]] = []
    validator_scores: dict[str, Any] = {}
    if candidate_outputs:
        verdicts = run_pipeline(candidate_outputs[-1]["content"], vctx)
        for v in verdicts:
            validator_rows.append({
                "kind": v.validator_kind,
                "axis": v.axis,
                "verdict": v.verdict,
                "score": v.score,
            })
            validator_scores[v.validator_kind] = {
                "axis": v.axis,
                "verdict": v.verdict,
                "score": v.score,
                "details": v.details,
            }

    # Judge. Two strategies via samplingParams.judge_strategy:
    #   one-shot (default): a single judge call sees ALL replayed turns and
    #     produces one verdict + one set of scores. Cheap, holistic.
    #   per-turn: one judge call per (user, assistant) pair, each
    #     producing its own scores. The aggregated `judge_result` below
    #     is the AVERAGE of per-turn scores so the run-level rollup
    #     (overall.axes / verdictCounts) still works. Per-turn rows are
    #     ALSO persisted to BenchmarkResult so the UI can drill into
    #     which turn failed.
    judge_strategy = sampling.get("judge_strategy") or "one-shot"

    # In per-turn mode the same `row_idx` produces N judge calls — we tag
    # each delta with the 1-indexed `turn` so the UI can render them as
    # separate sections instead of one concatenated blob.
    current_turn_for_deltas: dict[str, int] = {"value": 0}

    async def _judge_delta(text: str, judge_idx: int = 0, judge_name: str | None = None, judge_model_name: str | None = None) -> None:
        await _notify(run_id, {
            "event": "judge.delta",
            "index": row_idx,
            "turn": current_turn_for_deltas["value"],
            "judgeIdx": judge_idx,
            "judgeName": judge_name,
            "judgeModel": judge_model_name,
            "text": text,
        })

    per_turn_rows: list[dict[str, Any]] = []
    judge_result: dict[str, Any]
    # Collected per-turn ensemble breakdowns (one entry per turn block
    # when judge_strategy='per-turn', or a single entry for one-shot).
    ensemble_turns: list[dict[str, Any]] = []

    if judge_strategy == "per-turn":
        # Score each (user, assistant) pair separately. Aggregate scores
        # by average so the conversation-level rollup matches the same
        # shape as one-shot.
        accum_scores: dict[str, list[float]] = {}
        accum_verdicts: list[str] = []
        accum_rationales: list[str] = []
        accum_in = 0
        accum_out = 0
        accum_cost = 0.0
        # Per-turn judging iterates by turn BLOCK so multi-message turns
        # (tool call + tool result + follow-up) are scored together as one
        # logical turn instead of being split into separate evaluations.
        scored_blocks = (
            turn_blocks[:1] if mode == "single-turn" else turn_blocks
        )
        for t_i, block in enumerate(scored_blocks):
            current_turn_for_deltas["value"] = t_i + 1
            await _notify(run_id, {
                "event": "judge.start",
                "index": row_idx,
                "turn": t_i + 1,
                "totalTurns": len(scored_blocks),
            })
            u_text = block.get("user", {}).get("content") or ""
            # Build the reference transcript up to AND including this turn
            # block so the judge has the conversation arc as context.
            ref_msgs_through_t = (
                [{"role": "system", "content": system_text}] if system_text else []
            )
            for k in range(t_i + 1):
                blk_k = scored_blocks[k]
                ref_msgs_through_t.append(
                    {"role": "user", "content": (blk_k.get("user") or {}).get("content") or ""}
                )
                for bm in blk_k.get("messages") or []:
                    role_k = bm.get("role")
                    if role_k == "assistant":
                        ref_msgs_through_t.append(
                            {
                                "role": "assistant",
                                "content": bm.get("content") or "",
                                "tool_calls": _normalise_tool_calls(bm.get("toolCalls")),
                            }
                        )
                    elif role_k == "tool":
                        ref_msgs_through_t.append(
                            {
                                "role": "tool",
                                "content": bm.get("content") or "",
                                "tool_call_id": bm.get("toolCallId"),
                            }
                        )
            # Candidate messages = the full block: assistant + tool
            # messages stitched together (so the judge sees the tool call
            # and the follow-up text as one unit, not as separate turns).
            block_candidate_messages: list[dict[str, Any]] = []
            for bm in block.get("messages") or []:
                role_b = bm.get("role")
                if role_b == "assistant":
                    cand_m: dict[str, Any] = {
                        "role": "assistant",
                        "content": bm.get("content") or "",
                    }
                    tc = _normalise_tool_calls(bm.get("toolCalls"))
                    if tc:
                        cand_m["tool_calls"] = tc
                    block_candidate_messages.append(cand_m)
                elif role_b == "tool":
                    cand_m_tool: dict[str, Any] = {
                        "role": "tool",
                        "content": bm.get("content") or "",
                    }
                    tool_call_id = bm.get("toolCallId")
                    if tool_call_id:
                        cand_m_tool["tool_call_id"] = tool_call_id
                    block_candidate_messages.append(cand_m_tool)
            turn_judge = await _call_consensus_judge(
                judges=judges,
                consensus_method=consensus_method,
                rubric_axes=rubric_axes,
                system_text=system_text,
                user_text=u_text or "",
                reference_messages=ref_msgs_through_t,
                candidate_messages=block_candidate_messages,
                sampling=sampling,
                on_delta=_judge_delta,
            )
            ensemble_turns.append({
                "turn": t_i + 1,
                **(turn_judge.get("ensemble") or {}),
            })
            ts = turn_judge.get("scores") or {}
            for k_axis, v_axis in ts.items():
                if isinstance(v_axis, (int, float)):
                    accum_scores.setdefault(k_axis, []).append(float(v_axis))
            verdict = turn_judge.get("verdict") or "fail"
            accum_verdicts.append(verdict)
            accum_rationales.append(turn_judge.get("rationale") or "")
            accum_in += int(turn_judge.get("tokens_in") or 0)
            accum_out += int(turn_judge.get("tokens_out") or 0)
            accum_cost += float(turn_judge.get("cost_usd") or 0.0)
            per_turn_rows.append({
                "turn": t_i + 1,
                "scores": ts,
                "verdict": verdict,
                "rationale": turn_judge.get("rationale") or "",
                "candidate_messages": block_candidate_messages,
                "tokens_in": int(turn_judge.get("tokens_in") or 0),
                "tokens_out": int(turn_judge.get("tokens_out") or 0),
                "cost_usd": float(turn_judge.get("cost_usd") or 0.0),
                "ensemble": turn_judge.get("ensemble"),
            })

        avg_scores = {k: sum(vs) / len(vs) for k, vs in accum_scores.items() if vs}
        # Roll-up verdict: worst of all turn verdicts (pass < warn < fail).
        order = {"pass": 0, "warn": 1, "fail": 2}
        worst = "pass"
        for v in accum_verdicts:
            if order.get(v, 0) > order.get(worst, 0):
                worst = v
        judge_result = {
            "scores": avg_scores,
            "verdict": worst if accum_verdicts else "fail",
            "rationale": "\n\n— next turn —\n\n".join(
                r for r in accum_rationales if r
            ),
            "tokens_in": accum_in,
            "tokens_out": accum_out,
            "cost_usd": accum_cost,
        }
        tokens_in += accum_in
        tokens_out += accum_out
        cost_usd += accum_cost
    else:
        # One-shot — original path.
        judge_input_user_text = user_msgs[0].get("content") if user_msgs else ""
        judge_reference = [
            {"role": "assistant", "content": m.get("content") or "", "tool_calls": _normalise_tool_calls(m.get("toolCalls"))}
            for m in reference_assistants[:user_idx]
        ]
        await _notify(run_id, {"event": "judge.start", "index": row_idx})
        judge_result = await _call_consensus_judge(
            judges=judges,
            consensus_method=consensus_method,
            rubric_axes=rubric_axes,
            system_text=system_text,
            user_text=judge_input_user_text or "",
            reference_messages=(
                [{"role": "system", "content": system_text}] if system_text else []
            )
            + [{"role": "user", "content": m.get("content") or ""} for m in user_msgs[:user_idx]]
            + judge_reference,
            candidate_messages=candidate_outputs,
            sampling=sampling,
            on_delta=_judge_delta,
        )
        if judge_result.get("ensemble"):
            ensemble_turns.append({"turn": 1, **judge_result["ensemble"]})
        tokens_in += int(judge_result.get("tokens_in") or 0)
        tokens_out += int(judge_result.get("tokens_out") or 0)
        cost_usd += float(judge_result.get("cost_usd") or 0.0)

    # Persist the BenchmarkResult row.
    # IMPORTANT: every JSONB parameter is cast `::jsonb` so the JSON-
    # encoded string we pass is parsed into an actual JSON object/array,
    # not stored as a quoted string. Without the cast, asyncpg encodes a
    # Python str as a JSON-string value, which made the Next.js UI iterate
    # it character-by-character (the "0..442 axis: —" bug).
    # Build the conversation-level ensembleResult payload. For per-turn
    # runs this is the list of per-turn ensemble breakdowns; for one-
    # shot it's a single entry. The UI reads this to render the per-
    # judge table in the expanded view.
    ensemble_payload: dict[str, Any] | None = None
    if ensemble_turns:
        ensemble_payload = {
            "method": consensus_method,
            "turns": ensemble_turns,
            "judgeCount": len(judges),
        }
    has_ensemble = bool(ensemble_payload)
    await db.execute(
        """
        INSERT INTO "BenchmarkResult" (
            id, "runId", split, "rowIdx", "turnNum", kind,
            "conversationId", "referenceMessages", "candidateMessages",
            "validatorScores", "judgeScores", "judgeVerdict", "judgeRationale",
            "functionCallScore", "apiFailed", "tokensIn", "tokensOut", "costUsd",
            "ensembleResult", "ensembledAt"
        )
        VALUES (
            $1, $2, $3, $4, $5, 'chat-replay',
            $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12,
            $13::jsonb, false, $14, $15, $16,
            $17::jsonb, $18
        )
        """,
        _new_id(),
        run_id,
        split,
        row_idx,
        turn_num,
        conv["id"],
        json.dumps(
            [
                {
                    "ordinal": m.get("ordinal"),
                    "role": m.get("role"),
                    "content": m.get("content"),
                    "toolCalls": _normalise_tool_calls(m.get("toolCalls")) or None,
                }
                for m in messages
            ]
        ),
        json.dumps(candidate_outputs),
        json.dumps(validator_scores) if validator_scores else None,
        json.dumps(judge_result.get("scores") or {}),
        judge_result.get("verdict") or "fail",
        judge_result.get("rationale") or "",
        json.dumps(fc_rows) if fc_rows else None,
        tokens_in,
        tokens_out,
        round(cost_usd, 6),
        json.dumps(ensemble_payload) if ensemble_payload else None,
        _now() if has_ensemble else None,
    )

    # In per-turn mode, also write one BenchmarkResult per turn so the
    # Per-item table can show turn-level scores. The conversation-level
    # row above is kept as the rolled-up summary (averaged scores,
    # worst verdict) so the leaderboard / overall metrics still work the
    # same way.
    if judge_strategy == "per-turn":
        for tr in per_turn_rows:
            tr_ens = tr.get("ensemble") or None
            await db.execute(
                """
                INSERT INTO "BenchmarkResult" (
                    id, "runId", split, "rowIdx", "turnNum", kind,
                    "conversationId", "referenceMessages", "candidateMessages",
                    "validatorScores", "judgeScores", "judgeVerdict", "judgeRationale",
                    "functionCallScore", "apiFailed", "tokensIn", "tokensOut", "costUsd",
                    "ensembleResult", "ensembledAt"
                )
                VALUES (
                    $1, $2, $3, $4, $5, 'chat-replay-turn',
                    $6, $7::jsonb, $8::jsonb, NULL, $9::jsonb, $10, $11,
                    NULL, false, $12, $13, $14,
                    $15::jsonb, $16
                )
                """,
                _new_id(),
                run_id,
                split,
                row_idx,
                int(tr["turn"]),
                conv["id"],
                json.dumps(
                    [
                        {
                            "ordinal": m.get("ordinal"),
                            "role": m.get("role"),
                            "content": m.get("content"),
                            "toolCalls": _normalise_tool_calls(m.get("toolCalls")) or None,
                        }
                        for m in messages
                    ]
                ),
                json.dumps(tr["candidate_messages"]),
                json.dumps(tr["scores"] or {}),
                tr["verdict"] or "fail",
                tr["rationale"] or "",
                int(tr["tokens_in"]),
                int(tr["tokens_out"]),
                round(float(tr["cost_usd"]), 6),
                json.dumps(tr_ens) if tr_ens else None,
                _now() if tr_ens else None,
            )

    return {
        "split": split,
        "judge": {
            "scores": judge_result.get("scores") or {},
            "verdict": judge_result.get("verdict"),
            "rationale": judge_result.get("rationale") or "",
        },
        "candidate_outputs": candidate_outputs,
        "validator_rows": validator_rows,
        "fc_rows": fc_rows,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_usd": cost_usd,
    }


async def _persist_failure(
    run_id: str, row_idx: int, conv_id: str, bundle: dict[str, Any] | None, err: str
) -> None:
    split = (
        bundle["conversation"].get("primaryLanguage")
        if bundle and bundle.get("conversation")
        else "unknown"
    )
    await db.execute(
        """
        INSERT INTO "BenchmarkResult" (
            id, "runId", split, "rowIdx", "turnNum", kind, "conversationId",
            "judgeVerdict", "judgeRationale", "apiFailed"
        )
        VALUES ($1, $2, $3, $4, 0, 'chat-replay', $5, 'fail', $6, true)
        """,
        _new_id(),
        run_id,
        split or "unknown",
        row_idx,
        conv_id,
        f"replay failed: {err[:500]}",
    )


def _new_id() -> str:
    # asyncpg-friendly cuid-ish id. We use Python's secrets so worker output
    # collates fine with @default(cuid()) values inserted from Next.js.
    import secrets
    import string

    alphabet = string.ascii_lowercase + string.digits
    return "c" + "".join(secrets.choice(alphabet) for _ in range(24))


def _rollup_axes(
    items: list[dict[str, Any]], rubric_axes: list[dict[str, Any]]
) -> dict[str, float | None]:
    """Mean score per axis across all judged items, normalised to 0–1 of the
    axis scale (so axes with different scales are comparable).
    """
    keys = [a.get("key", "axis") for a in rubric_axes]
    scales = {a.get("key", "axis"): max(1, int(a.get("scale", 5))) for a in rubric_axes}
    if not items:
        return {k: None for k in keys}
    sums: dict[str, float] = {k: 0.0 for k in keys}
    counts: dict[str, int] = {k: 0 for k in keys}
    for it in items:
        scores = it.get("scores") or {}
        for k in keys:
            v = scores.get(k)
            if isinstance(v, (int, float)):
                sums[k] += float(v)
                counts[k] += 1
    return {
        k: (sums[k] / counts[k] / scales[k]) if counts[k] > 0 else None
        for k in keys
    }


def _rollup_validators(rows: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """For each validator kind, return pass-rate over all items it ran on."""
    by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_kind[r["kind"]].append(r)
    out: dict[str, dict[str, float]] = {}
    for kind, rs in by_kind.items():
        n = len(rs)
        passes = sum(1 for r in rs if r.get("verdict") == "pass")
        warns = sum(1 for r in rs if r.get("verdict") == "warn")
        fails = sum(1 for r in rs if r.get("verdict") == "fail")
        scores = [r["score"] for r in rs if isinstance(r.get("score"), (int, float))]
        out[kind] = {
            "total": n,
            "passRate": passes / n if n else 0.0,
            "warnRate": warns / n if n else 0.0,
            "failRate": fails / n if n else 0.0,
            "meanScore": sum(scores) / len(scores) if scores else None,
        }
    return out


def _verdict_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"pass": 0, "warn": 0, "fail": 0}
    for it in items:
        v = it.get("verdict")
        if v in counts:
            counts[v] += 1
    return counts
