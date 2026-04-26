"""Dataset export builders.

Slice 1 ships OpenAI fine-tune JSONL only. Each line: {"messages": [...]}.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from . import db
from .config import get_settings


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
    if artifact["format"] != "openai-jsonl":
        raise RuntimeError(f"Unsupported export format in slice 1: {artifact['format']}")

    settings = get_settings()
    out = settings.exports_path / artifact["storagePath"]

    conv_rows = await db.fetch_all(
        """
        SELECT "conversationId" FROM "DatasetVersionConversation"
        WHERE "datasetVersionId" = $1
        """,
        artifact["datasetVersionId"],
    )
    conversation_ids = [r["conversationId"] for r in conv_rows]

    try:
        result = await export_openai_jsonl(
            dataset_version_id=artifact["datasetVersionId"],
            conversation_ids=conversation_ids,
            output_path=out,
        )
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
    except Exception as e:
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
