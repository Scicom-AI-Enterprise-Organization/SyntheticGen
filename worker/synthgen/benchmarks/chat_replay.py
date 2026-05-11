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
from ..providers import chat_completion
from ..validators import ValidatorContext, run_pipeline
from .judge import call_judge
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
    if out["judge_provider_id"]:
        jrow = await db.fetch_one(
            """
            SELECT "baseUrl", "encryptedApiKey", headers, "reasoningEffort", "chatTemplateKwargs"
            FROM "ProviderCredential"
            WHERE id = $1
            """,
            out["judge_provider_id"],
        )
        if jrow:
            out["judge_base_url"] = jrow["baseUrl"]
            out["judge_key"] = jrow["encryptedApiKey"]
            out["judge_headers"] = jrow["headers"]
            out["judge_reasoning"] = jrow["reasoningEffort"]
            out["judge_chat_template"] = jrow["chatTemplateKwargs"]
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
    clauses = []
    values: list[Any] = []
    for i, (k, v) in enumerate(fields.items(), start=2):
        clauses.append(f'"{k}" = ${i}')
        values.append(v)
    clauses.append('"updatedAt" = NOW()')
    sql = f'UPDATE "BenchmarkRun" SET {", ".join(clauses)} WHERE id = $1'
    await db.execute(sql, run_id, *values)


async def _check_cancelled(run_id: str) -> bool:
    row = await db.fetch_one('SELECT status FROM "BenchmarkRun" WHERE id = $1', run_id)
    return bool(row and row["status"] == "cancelled")


def _now() -> Any:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


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
    if not run.get("judge_provider_id") or not run.get("judge_model"):
        await _set_status(
            run_id,
            status="failed",
            lastError="No judge provider/model configured for this run.",
            completedAt=_now(),
        )
        return

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
    judge_key = decrypt_secret(run["judge_key"])
    cand_headers = _parse_jsonb(run.get("cand_headers"))
    judge_headers = _parse_jsonb(run.get("judge_headers"))
    cand_chat_template = _parse_jsonb(run.get("cand_chat_template"))
    judge_chat_template = _parse_jsonb(run.get("judge_chat_template"))
    sampling = _parse_jsonb(run.get("sampling_params")) or {}
    mode = run.get("mode") or "multi-turn"

    await _set_status(run_id, status="running", startedAt=_now(), totalTurns=len(frozen_ids))

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

    try:
        for row_idx, conv_id in enumerate(frozen_ids):
            if await _check_cancelled(run_id):
                log.info("chat-replay run %s cancelled — stopping", run_id)
                return

            bundle = await _load_conversation_bundle(conv_id)
            if not bundle:
                failed += 1
                continue

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
                    judge_base=run["judge_base_url"],
                    judge_key=judge_key,
                    judge_model=run["judge_model"],
                    judge_headers=judge_headers,
                    judge_reasoning=run.get("judge_reasoning"),
                    judge_chat_template=judge_chat_template,
                )
            except Exception as e:
                log.exception("chat-replay item failed run=%s conv=%s", run_id, conv_id)
                failed += 1
                await _persist_failure(run_id, row_idx, conv_id, bundle, str(e))
                completed += 1
                if completed % 5 == 0:
                    await _set_status(
                        run_id, completedTurns=completed, failedTurns=failed
                    )
                continue

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
            if completed % 5 == 0:
                await _set_status(
                    run_id,
                    completedTurns=completed,
                    failedTurns=failed,
                    tokensIn=total_tokens_in,
                    tokensOut=total_tokens_out,
                    costUsd=round(total_cost, 6),
                )

        metrics = {
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
                for split in (
                    set(per_split_judge) | set(per_split_validators) | set(per_split_fc)
                )
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
    judge_base: str,
    judge_key: str,
    judge_model: str,
    judge_headers: Any,
    judge_reasoning: str | None,
    judge_chat_template: Any,
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

    # Walk turns: for multi-turn we feed each recorded user turn in order;
    # for single-turn we stop after the first.
    context: list[dict[str, Any]] = []
    if system_msg:
        context.append({"role": "system", "content": system_text})

    user_idx = 0
    turn_num = 0
    for msg in messages:
        if msg.get("role") == "system":
            continue
        if msg.get("role") == "user":
            user_idx += 1
            turn_num += 1
            context.append({"role": "user", "content": msg.get("content") or ""})

            cand_result = await chat_completion(
                base_url=candidate_base,
                api_key=candidate_key,
                model=candidate_model,
                messages=context,
                tools=tools,
                temperature=float(sampling.get("temperature", 0.7)),
                top_p=float(sampling.get("top_p", 1.0)),
                max_tokens=int(sampling.get("max_tokens", 4096)),
                seed=sampling.get("seed"),
                extra_headers=candidate_headers if isinstance(candidate_headers, dict) else None,
                reasoning_effort=candidate_reasoning,
                chat_template_kwargs=candidate_chat_template if isinstance(candidate_chat_template, dict) else None,
            )
            tokens_in += cand_result.tokens_in
            tokens_out += cand_result.tokens_out
            cost_usd += cand_result.cost_usd

            cand_msg: dict[str, Any] = {
                "role": "assistant",
                "content": cand_result.content or "",
            }
            if cand_result.tool_calls:
                cand_msg["tool_calls"] = _normalise_tool_calls(cand_result.tool_calls)
            candidate_outputs.append(cand_msg)
            context.append(cand_msg)

            # Function-call comparison: find the matching reference assistant
            # turn (1:1 by ordinal among user→assistant pairs) and score.
            ref_assistant = (
                reference_assistants[user_idx - 1] if user_idx - 1 < len(reference_assistants) else None
            )
            if ref_assistant:
                exp_tc = _normalise_tool_calls(ref_assistant.get("toolCalls"))
                pred_tc = cand_msg.get("tool_calls") or []
                if exp_tc or pred_tc:
                    call_results = evaluate_multiple_tool_calls(exp_tc, pred_tc, api_failed=False)
                    for r in call_results:
                        r.update({"row": row_idx, "turn": turn_num, "split": split})
                    fc_rows.extend(call_results)

            if mode == "single-turn":
                break
            continue

        # For multi-turn, feed reference tool/assistant turns back into the
        # context only if the candidate didn't already produce one for this
        # position. To keep replays deterministic and *not* contaminate with
        # reference assistant text, we instead skip non-user reference turns —
        # the candidate sees only the user's next turn following its own reply.

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

    # Judge.
    judge_input_user_text = user_msgs[0].get("content") if user_msgs else ""
    judge_reference = [
        {"role": "assistant", "content": m.get("content") or "", "tool_calls": _normalise_tool_calls(m.get("toolCalls"))}
        for m in reference_assistants[:user_idx]  # only the assistant turns we actually replayed
    ]
    judge_result = await call_judge(
        base_url=judge_base,
        api_key=judge_key,
        model=judge_model,
        rubric_axes=rubric_axes,
        system_text=system_text,
        user_text=judge_input_user_text or "",
        reference_messages=(
            [{"role": "system", "content": system_text}] if system_text else []
        )
        + [{"role": "user", "content": m.get("content") or ""} for m in user_msgs[:user_idx]]
        + judge_reference,
        candidate_messages=candidate_outputs,
        extra_headers=judge_headers if isinstance(judge_headers, dict) else None,
        reasoning_effort=judge_reasoning,
        chat_template_kwargs=judge_chat_template if isinstance(judge_chat_template, dict) else None,
    )
    tokens_in += int(judge_result.get("tokens_in") or 0)
    tokens_out += int(judge_result.get("tokens_out") or 0)
    cost_usd += float(judge_result.get("cost_usd") or 0.0)

    # Persist the BenchmarkResult row.
    await db.execute(
        """
        INSERT INTO "BenchmarkResult" (
            id, "runId", split, "rowIdx", "turnNum", kind,
            "conversationId", "referenceMessages", "candidateMessages",
            "validatorScores", "judgeScores", "judgeVerdict", "judgeRationale",
            "functionCallScore", "apiFailed", "tokensIn", "tokensOut", "costUsd"
        )
        VALUES (
            $1, $2, $3, $4, $5, 'chat-replay',
            $6, $7, $8, $9, $10, $11, $12, $13, false, $14, $15, $16
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
    )

    return {
        "split": split,
        "judge": {"scores": judge_result.get("scores") or {}, "verdict": judge_result.get("verdict")},
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
