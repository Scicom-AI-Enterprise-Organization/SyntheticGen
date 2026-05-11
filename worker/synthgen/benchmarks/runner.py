"""Benchmark run orchestration.

Driven by the FastAPI endpoint POST /internal/benchmark-runs/{id}/start.
Spawned as a background asyncio task so the HTTP request returns immediately
and the worker writes progress + final metrics back to the BenchmarkRun row.

Per-row flow (mirrors small-ablation/main.py:eval_row):
  1. Parse the row's `conversation` (list of {role, content, tool_calls,
     tool_call_id}) and `functions` (list of OpenAI function-tool defs).
  2. Walk the messages; each time we hit an assistant turn with `tool_calls`,
     send the prior context + tools to the target model and capture its
     predicted tool_calls.
  3. Score predicted vs expected with `evaluate_multiple_tool_calls`, attach
     row + turn indices, accumulate.
  4. After all rows in all splits are processed, roll up to per-split + overall
     metrics and write them to BenchmarkRun.metrics.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from .. import db
from ..crypto import decrypt_secret
from ..providers import chat_completion
from .chat_replay import execute_chat_replay_run
from .scoring import aggregate_metrics, evaluate_multiple_tool_calls


log = logging.getLogger(__name__)


async def _load_run(run_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """
        SELECT br.id, br."benchmarkId", br."providerCredentialId", br.model, br.status,
               b.source, b.splits, b."maxRowsPerSplit", b.config,
               pc."baseUrl", pc."encryptedApiKey", pc.headers,
               pc."reasoningEffort", pc."chatTemplateKwargs"
        FROM "BenchmarkRun" br
        JOIN "Benchmark" b ON b.id = br."benchmarkId"
        JOIN "ProviderCredential" pc ON pc.id = br."providerCredentialId"
        WHERE br.id = $1
        """,
        run_id,
    )
    if not row:
        raise RuntimeError(f"BenchmarkRun not found: {run_id}")
    return dict(row)


def _parse_jsonb(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None
    return v


def _parse_row(row: dict[str, Any], cfg: dict[str, Any]) -> tuple[list[dict], list[dict]] | None:
    """Extract (messages, tools) from a HF dataset row.

    The Scicom Function-Call dataset stores both fields as JSON strings; we
    accept either pre-parsed dicts or strings to be tolerant.
    """
    conv_field = (cfg or {}).get("conversationField", "conversation")
    funcs_field = (cfg or {}).get("functionsField", "functions")

    conv_raw = row.get(conv_field)
    funcs_raw = row.get(funcs_field)
    if conv_raw is None or funcs_raw is None:
        return None

    if isinstance(conv_raw, str):
        try:
            conv = json.loads(conv_raw)
        except json.JSONDecodeError:
            return None
    else:
        conv = conv_raw
    if isinstance(funcs_raw, str):
        try:
            funcs = json.loads(funcs_raw)
        except json.JSONDecodeError:
            return None
    else:
        funcs = funcs_raw

    messages = conv.get("messages") if isinstance(conv, dict) else None
    function_defs = funcs.get("functions") if isinstance(funcs, dict) else None
    if not isinstance(messages, list) or not isinstance(function_defs, list):
        return None

    tools = [
        {
            "type": "function",
            "function": {
                "name": f.get("name"),
                "description": f.get("description", ""),
                "parameters": f.get("parameters", {"type": "object", "properties": {}}),
            },
        }
        for f in function_defs
        if isinstance(f, dict) and f.get("name")
    ]
    return messages, tools


def _extract_predicted_tool_calls(api_response: Any) -> list[dict]:
    """Pull tool_calls out of a chat completion response, normalising to the
    {function: {name, arguments}} shape regardless of the upstream client."""
    if not isinstance(api_response, dict):
        return []
    choices = api_response.get("choices") or []
    if not choices:
        return []
    msg = choices[0].get("message") or {}
    raw = msg.get("tool_calls") or []
    out = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        fn = c.get("function") if isinstance(c.get("function"), dict) else c
        name = fn.get("name") if isinstance(fn, dict) else None
        args = fn.get("arguments") if isinstance(fn, dict) else None
        if isinstance(args, (dict, list)):
            args = json.dumps(args, ensure_ascii=False)
        elif not isinstance(args, str):
            args = "{}"
        if name:
            out.append({"function": {"name": name, "arguments": args}})
    return out


def _load_split_rows(source: str, split: str, max_rows: int | None) -> list[dict[str, Any]]:
    """Load a single dataset split into a list of dicts.

    Source format is `hf:<org>/<dataset>`. `split` becomes the `config_name`
    argument to `datasets.load_dataset` (matching small-ablation/main.py's
    `load_dataset(dataset_name, config, split=split)` usage with split="train").
    """
    if not source.startswith("hf:"):
        raise RuntimeError(f"Unsupported benchmark source: {source}")
    name = source[len("hf:") :]

    from datasets import load_dataset  # imported lazily so the worker boots without it

    ds = load_dataset(name, split, split="train")
    rows: list[dict[str, Any]] = []
    for i, row in enumerate(ds):
        if max_rows is not None and i >= max_rows:
            break
        rows.append(dict(row))
    return rows


async def _set_status(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    set_clauses = []
    values: list[Any] = []
    for i, (k, v) in enumerate(fields.items(), start=2):
        set_clauses.append(f'"{k}" = ${i}')
        values.append(v)
    set_clauses.append('"updatedAt" = NOW()')
    sql = f'UPDATE "BenchmarkRun" SET {", ".join(set_clauses)} WHERE id = $1'
    await db.execute(sql, run_id, *values)


async def execute_benchmark_run(run_id: str) -> None:
    """Top-level entry. Dispatches by Benchmark.kind so function-call benchmarks
    use the legacy HF-dataset runner and project chat-replay benchmarks use the
    new replay+judge pipeline. Idempotent against an already-running run id
    (the SQL UPDATE for `running` filters on prior status)."""
    kind_row = await db.fetch_one(
        """
        SELECT b.kind FROM "BenchmarkRun" br
        JOIN "Benchmark" b ON b.id = br."benchmarkId"
        WHERE br.id = $1
        """,
        run_id,
    )
    if kind_row and kind_row["kind"] == "project-chat-replay":
        await execute_chat_replay_run(run_id)
        return

    try:
        run = await _load_run(run_id)
    except Exception:
        log.exception("benchmark run lookup failed: %s", run_id)
        return

    if run["status"] in {"completed", "cancelled"}:
        log.info("skip benchmark run %s — already %s", run_id, run["status"])
        return

    api_key = decrypt_secret(run["encryptedApiKey"])
    base_url = run["baseUrl"]
    headers = run.get("headers")
    if isinstance(headers, str):
        headers = json.loads(headers) if headers else None

    cfg = _parse_jsonb(run.get("config")) or {}

    await _set_status(run_id, status="running", startedAt=_now_marker())

    all_results: list[dict[str, Any]] = []
    per_split_results: dict[str, list[dict[str, Any]]] = {}
    completed = 0
    failed = 0

    try:
        # First pass: count total turns we'll attempt so the UI shows progress
        # against a real denominator.
        rows_by_split: dict[str, list[dict[str, Any]]] = {}
        total_turns = 0
        for split in run["splits"]:
            rows = await asyncio.to_thread(
                _load_split_rows, run["source"], split, run["maxRowsPerSplit"]
            )
            rows_by_split[split] = rows
            for row in rows:
                parsed = _parse_row(row, cfg)
                if not parsed:
                    continue
                messages, _ = parsed
                total_turns += sum(
                    1 for m in messages if m.get("role") == "assistant" and m.get("tool_calls")
                )
        await _set_status(run_id, totalTurns=total_turns)

        # Second pass: actually call the model.
        for split in run["splits"]:
            split_results: list[dict[str, Any]] = []
            for row_idx, row in enumerate(rows_by_split[split]):
                # Per-iteration cancellation check.
                check = await db.fetch_one(
                    """SELECT status FROM "BenchmarkRun" WHERE id = $1""", run_id
                )
                if check and check["status"] == "cancelled":
                    log.info("benchmark run %s cancelled — stopping", run_id)
                    return

                parsed = _parse_row(row, cfg)
                if not parsed:
                    continue
                messages, tools = parsed
                context: list[dict] = []
                turn_num = 0

                for msg in messages:
                    if msg.get("role") == "assistant" and msg.get("tool_calls"):
                        turn_num += 1
                        expected_calls = msg["tool_calls"]
                        api_failed = False
                        predicted_calls: list[dict] = []
                        try:
                            result = await chat_completion(
                                base_url=base_url,
                                api_key=api_key,
                                model=run["model"],
                                messages=context,
                                tools=tools,
                                temperature=0.0,
                                top_p=1.0,
                                max_tokens=None,
                                extra_headers=headers,
                                reasoning_effort=run.get("reasoningEffort"),
                                chat_template_kwargs=_parse_jsonb(run.get("chatTemplateKwargs")) or None,
                            )
                            predicted_calls = _extract_predicted_tool_calls(result.raw)
                        except Exception as e:
                            log.warning("model call failed run=%s row=%s turn=%s: %s", run_id, row_idx, turn_num, e)
                            api_failed = True
                            failed += 1

                        call_results = evaluate_multiple_tool_calls(
                            expected_calls, predicted_calls, api_failed=api_failed
                        )
                        for r in call_results:
                            r.update(
                                {
                                    "row": row_idx,
                                    "turn": turn_num,
                                    "split": split,
                                    "expected_call_count": len(expected_calls),
                                    "predicted_call_count": len(predicted_calls)
                                    if not api_failed
                                    else 0,
                                }
                            )
                        all_results.extend(call_results)
                        split_results.extend(call_results)
                        completed += 1
                        if completed % 10 == 0:
                            await _set_status(
                                run_id, completedTurns=completed, failedTurns=failed
                            )

                    context.append(msg)

            per_split_results[split] = split_results

        # Final metrics rollup.
        metrics = {
            "splits": {
                split: aggregate_metrics(rs) for split, rs in per_split_results.items()
            },
            "overall": aggregate_metrics(all_results),
        }
        await _set_status(
            run_id,
            status="completed",
            completedTurns=completed,
            failedTurns=failed,
            metrics=json.dumps(metrics),
            completedAt=_now_marker(),
        )
        log.info("benchmark run %s complete — %s turns, %s failed", run_id, completed, failed)

    except Exception as e:
        log.exception("benchmark run %s crashed", run_id)
        await _set_status(
            run_id,
            status="failed",
            lastError=str(e)[:1000],
            completedTurns=completed,
            failedTurns=failed,
            completedAt=_now_marker(),
        )


def _now_marker() -> Any:
    """Return a value asyncpg accepts as a timestamp. We use Postgres NOW()
    via the SET clause when possible, but for parameterised updates a Python
    datetime is the simplest portable thing."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)
