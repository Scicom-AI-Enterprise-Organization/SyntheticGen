"""Dataset export builders.

Supported formats:
  openai-jsonl         — one {"messages": [...]} per line, OpenAI fine-tune shape
  function-call-bench  — Scicom Function-Call benchmark shape
                         (HF dataset rows with stringified `conversation` + `functions`)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from . import db
from .config import get_settings


log = logging.getLogger(__name__)


@dataclass
class ExportResult:
    storage_path: str
    byte_size: int
    row_count: int
    checksum_sha256: str


async def _conversation_messages(conversation_id: str) -> list[dict[str, object]]:
    """Fetch the linear message thread for one conversation, OpenAI-shaped."""
    rows = await db.fetch_all(
        """
        SELECT role, content, "toolCalls", "toolCallId", ordinal
        FROM "Message"
        WHERE "conversationId" = $1
        ORDER BY ordinal ASC
        """,
        conversation_id,
    )
    out: list[dict[str, object]] = []
    for r in rows:
        msg: dict[str, object] = {"role": r["role"]}
        if r["content"] is not None:
            msg["content"] = r["content"]
        if r["toolCalls"]:
            msg["tool_calls"] = r["toolCalls"]
        if r["toolCallId"]:
            msg["tool_call_id"] = r["toolCallId"]
        out.append(msg)
    return out


async def export_openai_jsonl(
    *,
    dataset_version_id: str,
    conversation_ids: Iterable[str],
    output_path: Path,
) -> ExportResult:
    """Stream conversations into a single JSONL file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    sha = hashlib.sha256()
    row_count = 0
    byte_size = 0

    with output_path.open("wb") as f:
        for cid in conversation_ids:
            messages = await _conversation_messages(cid)
            if not messages:
                continue
            line = json.dumps({"messages": messages}, ensure_ascii=False) + "\n"
            buf = line.encode("utf-8")
            f.write(buf)
            sha.update(buf)
            row_count += 1
            byte_size += len(buf)

    return ExportResult(
        storage_path=str(output_path),
        byte_size=byte_size,
        row_count=row_count,
        checksum_sha256=sha.hexdigest(),
    )


async def _conversation_ids_for_version(dataset_version_id: str) -> list[str]:
    rows = await db.fetch_all(
        """SELECT "conversationId" FROM "DatasetVersionConversation"
           WHERE "datasetVersionId" = $1""",
        dataset_version_id,
    )
    return [r["conversationId"] for r in rows]


async def _conversation_language_map(conversation_ids: list[str]) -> dict[str, str | None]:
    if not conversation_ids:
        return {}
    rows = await db.fetch_all(
        """SELECT id, "primaryLanguage" FROM "Conversation" WHERE id = ANY($1::text[])""",
        conversation_ids,
    )
    return {r["id"]: r["primaryLanguage"] for r in rows}


async def _tool_defs_by_name() -> dict[str, dict[str, Any]]:
    """Cache of tool name → {description, parameters} across all catalogs.

    The benchmark format embeds a `functions` block per row containing the JSON Schema
    of every tool the assistant might call. We pull from the project-agnostic ToolDef
    table because conversations may reference tools across catalogs.
    """
    rows = await db.fetch_all(
        """SELECT name, description, parameters FROM "ToolDef" """,
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        params = r["parameters"]
        if isinstance(params, str):
            params = json.loads(params)
        # If the same tool name appears in multiple catalogs, keep the latest definition.
        out[r["name"]] = {
            "name": r["name"],
            "description": r["description"] or "",
            "parameters": params or {"type": "object", "properties": {}},
        }
    return out


def _normalize_tool_calls(raw: Any) -> list[dict[str, Any]]:
    """Coerce a Message.toolCalls JSONB blob into the OpenAI tool_calls shape."""
    if raw is None:
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
        # Accept both flat {name, arguments} and OpenAI-shaped {function: {name, arguments}}.
        fn = c.get("function") if isinstance(c.get("function"), dict) else c
        name = fn.get("name") if isinstance(fn, dict) else None
        args = fn.get("arguments") if isinstance(fn, dict) else None
        if not isinstance(name, str):
            continue
        if isinstance(args, (dict, list)):
            args_str = json.dumps(args, ensure_ascii=False)
        elif isinstance(args, str):
            args_str = args
        else:
            args_str = "{}"
        out.append(
            {
                "id": c.get("id") or fn.get("id") or "",
                "type": "function",
                "function": {"name": name, "arguments": args_str},
            }
        )
    return out


async def export_function_call_benchmark(
    *,
    conversation_ids: list[str],
    output_path: Path,
) -> ExportResult:
    """Emit JSONL in the Scicom Function-Call benchmark shape.

    One row per conversation, fields stringified to match HF dataset conventions:
      {
        "conversation": "{\\"messages\\": [...]}",
        "functions":    "{\\"functions\\": [...]}",
        "language":     "ms" | "en" | "zh" | null
      }

    Only conversations that contain at least one assistant tool_calls turn are
    included — the benchmark scores tool-call accuracy and a tool-less conversation
    is empty signal.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    tool_catalog = await _tool_defs_by_name()
    languages = await _conversation_language_map(conversation_ids)

    sha = hashlib.sha256()
    row_count = 0
    byte_size = 0
    skipped_no_tool_calls = 0
    skipped_unknown_tools: list[str] = []

    with output_path.open("wb") as f:
        for cid in conversation_ids:
            msgs = await db.fetch_all(
                """
                SELECT role, content, "toolCalls", "toolCallId", ordinal
                FROM "Message"
                WHERE "conversationId" = $1
                ORDER BY ordinal ASC
                """,
                cid,
            )
            if not msgs:
                continue

            referenced: set[str] = set()
            messages_out: list[dict[str, Any]] = []
            has_assistant_tool_calls = False
            for m in msgs:
                role = m["role"]
                obj: dict[str, Any] = {"role": role}
                if m["content"] is not None:
                    obj["content"] = m["content"]
                if role == "assistant":
                    tool_calls = _normalize_tool_calls(m["toolCalls"])
                    if tool_calls:
                        obj["tool_calls"] = tool_calls
                        has_assistant_tool_calls = True
                        for tc in tool_calls:
                            referenced.add(tc["function"]["name"])
                if role == "tool" and m["toolCallId"]:
                    obj["tool_call_id"] = m["toolCallId"]
                messages_out.append(obj)

            if not has_assistant_tool_calls:
                skipped_no_tool_calls += 1
                continue

            functions: list[dict[str, Any]] = []
            for name in sorted(referenced):
                td = tool_catalog.get(name)
                if td is None:
                    # Conversation references a tool that isn't in the catalog (e.g. it
                    # was deleted, or the worker generated a hallucinated tool name).
                    # Synthesize a minimal stub so the benchmark can still parse the row.
                    skipped_unknown_tools.append(name)
                    functions.append(
                        {
                            "name": name,
                            "description": "(tool definition missing from catalog)",
                            "parameters": {"type": "object", "properties": {}},
                        }
                    )
                else:
                    functions.append(td)

            row = {
                "conversation": json.dumps({"messages": messages_out}, ensure_ascii=False),
                "functions": json.dumps({"functions": functions}, ensure_ascii=False),
                "language": languages.get(cid),
            }
            buf = (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")
            f.write(buf)
            sha.update(buf)
            row_count += 1
            byte_size += len(buf)

    if skipped_no_tool_calls:
        log.info(
            "function-call-bench export: skipped %d conversation(s) with no assistant tool_calls",
            skipped_no_tool_calls,
        )
    if skipped_unknown_tools:
        log.warning(
            "function-call-bench export: %d unknown tool reference(s) stubbed: %s",
            len(skipped_unknown_tools),
            sorted(set(skipped_unknown_tools))[:10],
        )

    return ExportResult(
        storage_path=str(output_path),
        byte_size=byte_size,
        row_count=row_count,
        checksum_sha256=sha.hexdigest(),
    )


async def build_export(export_id: str) -> ExportResult:
    """Build a single ExportArtifact row's file. Updates the artifact's status."""
    artifact = await db.fetch_one(
        """
        SELECT a.id, a.format, a."datasetVersionId", a."storagePath",
               dv."datasetId"
        FROM "ExportArtifact" a
        JOIN "DatasetVersion" dv ON dv.id = a."datasetVersionId"
        WHERE a.id = $1
        """,
        export_id,
    )
    if not artifact:
        raise RuntimeError(f"ExportArtifact not found: {export_id}")

    settings = get_settings()
    out = settings.exports_path / artifact["storagePath"]
    conversation_ids = await _conversation_ids_for_version(artifact["datasetVersionId"])

    try:
        if artifact["format"] == "openai-jsonl":
            result = await export_openai_jsonl(
                dataset_version_id=artifact["datasetVersionId"],
                conversation_ids=conversation_ids,
                output_path=out,
            )
        elif artifact["format"] == "function-call-bench":
            result = await export_function_call_benchmark(
                conversation_ids=conversation_ids,
                output_path=out,
            )
        else:
            raise RuntimeError(f"Unsupported export format: {artifact['format']}")

        await db.execute(
            """
            UPDATE "ExportArtifact"
            SET status = 'ready', "byteSize" = $1, "rowCount" = $2,
                "checksumSha256" = $3, "updatedAt" = NOW()
            WHERE id = $4
            """,
            result.byte_size,
            result.row_count,
            result.checksum_sha256,
            export_id,
        )
        return result
    except Exception:
        await db.execute(
            """UPDATE "ExportArtifact" SET status = 'failed', "updatedAt" = NOW() WHERE id = $1""",
            export_id,
        )
        raise


async def main_cli(export_id: str) -> None:
    """CLI entry — `python -m synthgen.exporter <export_id>`."""
    result = await build_export(export_id)
    print(json.dumps(result.__dict__, indent=2))


if __name__ == "__main__":
    import sys

    asyncio.run(main_cli(sys.argv[1]))
