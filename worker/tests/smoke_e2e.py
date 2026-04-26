"""End-to-end smoke test:

1. Use the existing smoke project + its bootstrap-seeded LanguageProfile.
2. Insert minimal Persona, PromptTemplate, ProviderCredential (pointing at stub).
3. Insert a GenerationRun + one GenerationJob.
4. Run execute_job() once.
5. Verify a Conversation + Messages + Validations landed.
6. Assert register-compliance verdict is "pass" (because stub returns clean Bahasa Baku).

Then repeat with the "manglish" trigger word and assert a register fail.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Ensure both ../.env and ../../.env resolve.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5434/enterprise")

import asyncpg  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent.parent))

from synthgen import db  # noqa: E402
from synthgen.crypto import encrypt_secret  # noqa: E402
from synthgen.generation import execute_job  # noqa: E402
from synthgen.ids import cuid_like  # noqa: E402

PROJECT_ID = "smoke-proj-001"


async def _admin_id(conn) -> str:
    row = await conn.fetchrow("""SELECT id FROM "User" WHERE email = 'admin@example.com'""")
    return row["id"]


async def _ensure_dependencies(conn) -> dict:
    admin = await _admin_id(conn)

    # Pick the formal preset already seeded by bootstrap.
    lp = await conn.fetchrow(
        """SELECT id FROM "LanguageProfile" WHERE "projectId" = $1 AND register = 'formal'""",
        PROJECT_ID,
    )
    if not lp:
        raise RuntimeError("expected formal LanguageProfile from bootstrap")

    # Persona.
    persona_id = cuid_like()
    await conn.execute(
        """
        INSERT INTO "Persona" (id, "projectId", name, "languageProfileId", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT ("projectId", name) DO UPDATE SET "updatedAt" = NOW()
        RETURNING id
        """,
        persona_id, PROJECT_ID, "Smoke Persona", lp["id"],
    )
    p = await conn.fetchrow(
        """SELECT id FROM "Persona" WHERE "projectId" = $1 AND name = $2""",
        PROJECT_ID, "Smoke Persona",
    )
    persona_id = p["id"]

    # Template.
    template_id = cuid_like()
    await conn.execute(
        """
        INSERT INTO "PromptTemplate" (id, "projectId", name, kind, body, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'user-seed', $4, NOW(), NOW())
        ON CONFLICT ("projectId", name, version) DO UPDATE SET "updatedAt" = NOW()
        """,
        template_id, PROJECT_ID, "Smoke Template",
        "Persona: {{persona.name}}. Soalan untuk operator telco. Trigger word: clean.",
    )
    t = await conn.fetchrow(
        """SELECT id FROM "PromptTemplate" WHERE "projectId" = $1 AND name = $2""",
        PROJECT_ID, "Smoke Template",
    )
    template_id = t["id"]

    # Taxonomy node.
    tax = await conn.fetchrow(
        """SELECT id FROM "Taxonomy" WHERE "projectId" = $1 AND name = 'default'""",
        PROJECT_ID,
    )
    if not tax:
        await conn.execute(
            """INSERT INTO "Taxonomy" (id, "projectId", name, "createdAt", "updatedAt")
               VALUES ($1, $2, 'default', NOW(), NOW())""",
            cuid_like(), PROJECT_ID,
        )
        tax = await conn.fetchrow(
            """SELECT id FROM "Taxonomy" WHERE "projectId" = $1 AND name = 'default'""",
            PROJECT_ID,
        )
    node_id = cuid_like()
    await conn.execute(
        """
        INSERT INTO "TaxonomyNode" (id, "taxonomyId", name, slug, path, depth, "createdAt")
        VALUES ($1, $2, 'billing', 'billing', '/billing', 1, NOW())
        ON CONFLICT ("taxonomyId", "parentId", slug) DO NOTHING
        """,
        node_id, tax["id"],
    )
    n = await conn.fetchrow(
        """SELECT id FROM "TaxonomyNode" WHERE "taxonomyId" = $1 AND slug = 'billing'""",
        tax["id"],
    )
    node_id = n["id"]

    # Provider — stub OpenAI on :8765.
    provider_id = cuid_like()
    encrypted = encrypt_secret("stub-key")
    await conn.execute(
        """
        INSERT INTO "ProviderCredential"
            (id, "projectId", name, kind, "baseUrl", "encryptedApiKey",
             "keyFingerprint", "defaultModel", "createdById", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'openai', 'http://127.0.0.1:8765/v1', $4,
                'stub', 'stub-model', $5, NOW(), NOW())
        ON CONFLICT ("projectId", name) DO UPDATE
          SET "encryptedApiKey" = EXCLUDED."encryptedApiKey", "updatedAt" = NOW()
        """,
        provider_id, PROJECT_ID, "Stub OpenAI", encrypted, admin,
    )
    pv = await conn.fetchrow(
        """SELECT id FROM "ProviderCredential" WHERE "projectId" = $1 AND name = $2""",
        PROJECT_ID, "Stub OpenAI",
    )
    provider_id = pv["id"]

    return {
        "lp_id": lp["id"],
        "persona_id": persona_id,
        "template_id": template_id,
        "node_id": node_id,
        "provider_id": provider_id,
        "admin_id": admin,
    }


async def _make_run(conn, deps, *, name: str, formality_policy: str = "inherit") -> tuple[str, str]:
    run_id = cuid_like()
    config = {
        "templateId": deps["template_id"],
        "languageProfileId": deps["lp_id"],
        "providerCredentialId": deps["provider_id"],
        "model": "stub-model",
        "samplingParams": {"temperature": 0.7},
        "formalityPolicy": formality_policy,
    }
    await conn.execute(
        """
        INSERT INTO "GenerationRun"
          (id, "projectId", name, status, "configSnapshot",
           "providerCredentialId", "templateId", "languageProfileId",
           model, "samplingParams", "gridSpec", "formalityPolicy",
           "targetCount", "createdById", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'queued', $4::jsonb,
                $5, $6, $7,
                'stub-model', '{}'::jsonb, '{}'::jsonb, $8,
                1, $9, NOW(), NOW())
        """,
        run_id, PROJECT_ID, name, json.dumps(config),
        deps["provider_id"], deps["template_id"], deps["lp_id"], formality_policy,
        deps["admin_id"],
    )

    job_id = cuid_like()
    await conn.execute(
        """
        INSERT INTO "GenerationJob"
          (id, "runId", "cellKey", status, "inputContext", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, 'pending', $4::jsonb, NOW(), NOW())
        """,
        job_id, run_id, f"smoke-{name}", json.dumps({
            "personaId": deps["persona_id"],
            "taxonomyNodeId": deps["node_id"],
            "difficulty": "medium",
        }),
    )
    return run_id, job_id


async def main():
    print("=== smoke e2e starting")
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        deps = await _ensure_dependencies(conn)
        print(f"  deps ready: {deps}")

        # CASE A — formal lock, stub returns clean Bahasa Baku
        run_id, job_id = await _make_run(
            conn, deps, name="smoke-formal", formality_policy="formal",
        )

    conv_id = await execute_job(job_id)
    print(f"  case A: conv {conv_id}")

    async with pool.acquire() as conn:
        c = await conn.fetchrow(
            """SELECT status, "primaryLanguage", "tokenCount" FROM "Conversation" WHERE id = $1""",
            conv_id,
        )
        verdicts = await conn.fetch(
            """SELECT "validatorKind", verdict FROM "Validation" WHERE "conversationId" = $1""",
            conv_id,
        )
        print(f"  case A conv: {dict(c)}")
        for v in verdicts:
            print(f"    {v['validatorKind']:25s} {v['verdict']}")
        assert c["status"] == "accepted", f"expected accepted, got {c['status']}"
        register_verdicts = [dict(v) for v in verdicts if v["validatorKind"] == "register-compliance"]
        # Warn is acceptable; we only object to fails here.
        assert not any(v["verdict"] == "fail" for v in register_verdicts), \
            f"register fail on clean Baku: {register_verdicts}"

    # CASE B — Manglish reply (stub keys on word "manglish" in user prompt)
    async with pool.acquire() as conn:
        # Update template body to include the trigger.
        await conn.execute(
            """UPDATE "PromptTemplate" SET body = $1 WHERE id = $2""",
            "Persona: {{persona.name}}. Trigger: manglish please.",
            deps["template_id"],
        )
        run_id_b, job_id_b = await _make_run(
            conn, deps, name="smoke-manglish", formality_policy="formal",
        )

    conv_id_b = await execute_job(job_id_b)
    print(f"  case B: conv {conv_id_b}")

    async with pool.acquire() as conn:
        c = await conn.fetchrow(
            """SELECT status FROM "Conversation" WHERE id = $1""", conv_id_b,
        )
        verdicts = await conn.fetch(
            """SELECT "validatorKind", verdict, details FROM "Validation"
               WHERE "conversationId" = $1 AND "validatorKind" = 'register-compliance'""",
            conv_id_b,
        )
        print(f"  case B conv status: {c['status']}")
        for v in verdicts:
            print(f"    register-compliance {v['verdict']:5s} {v['details']}")
        assert c["status"] == "rejected", f"expected rejected on Manglish, got {c['status']}"
        assert any(v["verdict"] == "fail" for v in verdicts), \
            "expected at least one register fail on Manglish"

    print("=== smoke e2e PASSED")
    await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
