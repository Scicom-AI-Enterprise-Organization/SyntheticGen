"""Smoke: freeze a dataset version of accepted convos, export to OpenAI JSONL."""
from __future__ import annotations

import asyncio
import json

from synthgen import db
from synthgen.exporter import build_export
from synthgen.ids import cuid_like


PROJECT = "smoke-proj-001"


async def main():
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        admin = await conn.fetchrow(
            """SELECT id FROM "User" WHERE email = 'admin@example.com'"""
        )

        ds_id = cuid_like()
        await conn.execute(
            """
            INSERT INTO "Dataset" (id, "projectId", name, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT ("projectId", name) DO UPDATE SET "updatedAt" = NOW()
            """,
            ds_id, PROJECT, "Smoke Dataset",
        )
        ds = await conn.fetchrow(
            """SELECT id FROM "Dataset" WHERE "projectId" = $1 AND name = $2""",
            PROJECT, "Smoke Dataset",
        )
        ds_id = ds["id"]

        ver_id = cuid_like()
        await conn.execute(
            """
            INSERT INTO "DatasetVersion"
                (id, "datasetId", version, "frozenById", stats, "frozenAt")
            VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
            """,
            ver_id, ds_id, f"0.1.0-smoke-{cuid_like()[:6]}", admin["id"],
            json.dumps({"rowCount": 0, "smoke": True}),
        )

        convos = await conn.fetch(
            """SELECT id FROM "Conversation" WHERE "projectId" = $1 AND status = 'accepted'""",
            PROJECT,
        )
        for c in convos:
            await conn.execute(
                """
                INSERT INTO "DatasetVersionConversation"
                    ("datasetVersionId", "conversationId", "addedAt")
                VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING
                """,
                ver_id, c["id"],
            )

        exp_id = cuid_like()
        await conn.execute(
            """
            INSERT INTO "ExportArtifact"
                (id, "datasetVersionId", format, "storageKind", "storagePath",
                 status, "createdById", "createdAt", "updatedAt")
            VALUES ($1, $2, 'openai-jsonl', 'local', $3, 'building', $4, NOW(), NOW())
            """,
            exp_id, ver_id, f"{PROJECT}/smoke-export-{ver_id[:6]}.jsonl", admin["id"],
        )

    result = await build_export(exp_id)
    print("export result:", result)
    with open(result.storage_path, "r", encoding="utf-8") as f:
        contents = f.read()
    print("--- jsonl contents ---")
    print(contents[:1500])
    await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
