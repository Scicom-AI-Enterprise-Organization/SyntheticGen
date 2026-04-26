"""Single-turn generation pipeline.

Slice 1: one LLM call per job, single-turn conversation, no tool calls.
Architecture allows multi-turn / tool-calls to slot in later without schema changes.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict
from typing import Any

from . import db
from .crypto import decrypt_secret
from .ids import cuid_like
from .providers import chat_completion
from .style_guide import FormalityPolicy, style_guide
from .templates import RenderContext, render
from .validators import ValidatorContext, run_pipeline


log = logging.getLogger(__name__)


def _as_dict(v: Any) -> dict[str, Any]:
    """Coerce a JSONB column value (which asyncpg returns as str) to a dict."""
    if v is None:
        return {}
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        return json.loads(v)
    return dict(v)


async def _load_run(run_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """
        SELECT id, "projectId", model, "samplingParams", "configSnapshot",
               "providerCredentialId", "templateId", "languageProfileId",
               "formalityPolicy", status
        FROM "GenerationRun" WHERE id = $1
        """,
        run_id,
    )
    if not row:
        raise RuntimeError(f"run not found: {run_id}")
    return dict(row)


async def _load_provider(provider_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """SELECT "baseUrl", "encryptedApiKey", headers, "defaultModel", kind
           FROM "ProviderCredential" WHERE id = $1""",
        provider_id,
    )
    if not row:
        raise RuntimeError(f"provider not found: {provider_id}")
    return dict(row)


async def _load_language_profile(profile_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """
        SELECT id, "primary", secondary, script,
               "codeSwitchPolicy", "codeSwitchRate",
               register, "allowParticles",
               "bannedTokens", "bannedPatterns", "requireBahasaBaku",
               "englishLoanwordPolicy", "loanwordAllowlist"
        FROM "LanguageProfile" WHERE id = $1
        """,
        profile_id,
    )
    if not row:
        raise RuntimeError(f"language profile not found: {profile_id}")
    return dict(row)


async def _load_persona(persona_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """
        SELECT id, name, ethnicity, region, urbanity, "ageRange",
               formality, "dialectTags", "languageProfileId"
        FROM "Persona" WHERE id = $1
        """,
        persona_id,
    )
    return dict(row) if row else None


async def _load_taxonomy_node(node_id: str) -> dict[str, Any] | None:
    row = await db.fetch_one(
        """SELECT id, name, slug, path FROM "TaxonomyNode" WHERE id = $1""",
        node_id,
    )
    return dict(row) if row else None


async def _load_template(template_id: str) -> dict[str, Any]:
    row = await db.fetch_one(
        """SELECT id, name, kind, body FROM "PromptTemplate" WHERE id = $1""",
        template_id,
    )
    if not row:
        raise RuntimeError(f"template not found: {template_id}")
    return dict(row)


def _resolve_formality(
    *,
    run_policy: str,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
) -> FormalityPolicy:
    """Apply the precedence: Run > Persona > LanguageProfile > project default."""
    register = lp.get("register") or "formal"
    allow_particles = bool(lp.get("allowParticles", False))

    if run_policy and run_policy != "inherit":
        register = run_policy
        if run_policy == "formal":
            allow_particles = False
    elif persona and persona.get("formality"):
        f = persona["formality"]
        if f == "baku":
            register = "formal"
            allow_particles = False
        elif f in {"colloquial", "manglish"}:
            register = "colloquial"
            allow_particles = True

    return FormalityPolicy(
        register=register,
        allow_particles=allow_particles,
        require_bahasa_baku=bool(lp.get("requireBahasaBaku", False)),
        english_loanword_policy=lp.get("englishLoanwordPolicy") or "free",
        loanword_allowlist=list(lp.get("loanwordAllowlist") or []),
        primary=lp.get("primary") or "ms",
    )


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def execute_job(job_id: str) -> str:
    """Run one generation job. Returns the conversation id created."""
    job = await db.fetch_one(
        """
        SELECT id, "runId", "cellKey", "inputContext", status, attempts
        FROM "GenerationJob" WHERE id = $1
        """,
        job_id,
    )
    if not job:
        raise RuntimeError(f"job not found: {job_id}")

    run = await _load_run(job["runId"])
    grid = _as_dict(run.get("configSnapshot"))
    sampling = _as_dict(run.get("samplingParams"))

    # The cellKey + inputContext encode the (taxonomy, persona, difficulty, idx) tuple.
    ctx_blob = _as_dict(job.get("inputContext"))
    persona_id = ctx_blob.get("personaId")
    node_id = ctx_blob.get("taxonomyNodeId")
    difficulty = ctx_blob.get("difficulty") or "medium"

    persona = await _load_persona(persona_id) if persona_id else None
    node = await _load_taxonomy_node(node_id) if node_id else None
    lp = await _load_language_profile(run["languageProfileId"])
    template = await _load_template(run["templateId"])
    provider = await _load_provider(run["providerCredentialId"])

    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = _as_dict(provider.get("headers"))

    # Build the formality-aware system prompt.
    policy = _resolve_formality(
        run_policy=run.get("formalityPolicy") or "inherit",
        persona=persona,
        lp=lp,
    )
    system_text = style_guide(policy)

    rctx = RenderContext(
        persona=(persona or {}),
        taxonomy=(node or {}),
        language={
            "primary": lp.get("primary"),
            "script": lp.get("script"),
            "register": policy.register,
        },
        difficulty=difficulty,
    )

    user_text = render(template["body"], rctx.to_dict())

    messages: list[dict[str, Any]] = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.append({"role": "user", "content": user_text})

    started_marker = await db.execute(
        """
        UPDATE "GenerationJob"
        SET status = 'running', attempts = attempts + 1, "startedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1
        """,
        job_id,
    )

    try:
        result = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            messages=messages,
            temperature=float(sampling.get("temperature", 0.7)),
            top_p=float(sampling.get("top_p", 1.0)),
            max_tokens=sampling.get("max_tokens", 1024),
            seed=sampling.get("seed"),
            extra_headers=extra_headers,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("provider call failed for job=%s", job_id)
        await db.execute(
            """
            UPDATE "GenerationJob"
            SET status = 'failed', "lastError" = $2, "finishedAt" = NOW(), "updatedAt" = NOW()
            WHERE id = $1
            """,
            job_id,
            str(e)[:1000],
        )
        raise

    # Validate the assistant content.
    vctx = ValidatorContext(
        primary_language=lp.get("primary") or "ms",
        script=lp.get("script") or "latin",
        register=policy.register,
        allow_particles=policy.allow_particles,
        banned_tokens=list(lp.get("bannedTokens") or []),
        banned_patterns=list(lp.get("bannedPatterns") or []),
        require_bahasa_baku=policy.require_bahasa_baku,
        english_loanword_policy=policy.english_loanword_policy,
        loanword_allowlist=policy.loanword_allowlist,
        code_switch_policy=lp.get("codeSwitchPolicy") or "none",
        code_switch_rate=lp.get("codeSwitchRate"),
    )
    verdicts = run_pipeline(result.content, vctx)
    has_fail = any(v.verdict == "fail" for v in verdicts)
    primary_lang = vctx.detected_language or vctx.primary_language

    conv_id = cuid_like()
    sys_msg_id = cuid_like()
    user_msg_id = cuid_like()
    asst_msg_id = cuid_like()

    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO "Conversation" (
                    id, "projectId", "runId", "taxonomyNodeId", "personaId",
                    "primaryLanguage", "primaryScript", difficulty, "turnCount",
                    "tokenCount", status, "dedupHash", "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, 1,
                    $9, $10, $11, NOW(), NOW()
                )
                """,
                conv_id,
                run["projectId"],
                run["id"],
                node_id,
                persona_id,
                primary_lang,
                lp.get("script") or "latin",
                difficulty,
                result.tokens_in + result.tokens_out,
                "rejected" if has_fail else "accepted",
                _content_hash(result.content),
            )

            ordinal = 0
            if system_text:
                await conn.execute(
                    """INSERT INTO "Message"
                       (id, "conversationId", ordinal, role, content, "createdAt")
                       VALUES ($1, $2, $3, 'system', $4, NOW())""",
                    sys_msg_id, conv_id, ordinal, system_text,
                )
                ordinal += 1
            await conn.execute(
                """INSERT INTO "Message"
                   (id, "conversationId", ordinal, role, content, "createdAt")
                   VALUES ($1, $2, $3, 'user', $4, NOW())""",
                user_msg_id, conv_id, ordinal, user_text,
            )
            ordinal += 1
            await conn.execute(
                """INSERT INTO "Message"
                   (id, "conversationId", ordinal, role, content, language, script,
                    "tokenCount", "latencyMs", model, "rawProviderResponse", "createdAt")
                   VALUES ($1, $2, $3, 'assistant', $4, $5, $6, $7, $8, $9, $10, NOW())""",
                asst_msg_id, conv_id, ordinal, result.content,
                primary_lang, lp.get("script") or "latin",
                result.tokens_out, result.latency_ms, result.model,
                json.dumps(result.raw),
            )

            for v in verdicts:
                await conn.execute(
                    """INSERT INTO "Validation"
                       (id, "conversationId", "validatorKind", axis, verdict, score,
                        details, "createdAt")
                       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())""",
                    cuid_like(), conv_id, v.validator_kind, v.axis, v.verdict, v.score,
                    json.dumps(v.details) if v.details else None,
                )

            await conn.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'succeeded', "conversationId" = $2,
                    "tokensIn" = $3, "tokensOut" = $4, "costUsd" = $5,
                    "latencyMs" = $6, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id, conv_id,
                result.tokens_in, result.tokens_out, result.cost_usd, result.latency_ms,
            )

            await conn.execute(
                """
                UPDATE "GenerationRun"
                SET "producedCount" = "producedCount" + 1,
                    "acceptedCount" = "acceptedCount" + $2,
                    "tokensIn" = "tokensIn" + $3,
                    "tokensOut" = "tokensOut" + $4,
                    "costUsd" = COALESCE("costUsd", 0) + $5,
                    "updatedAt" = NOW()
                WHERE id = $1
                """,
                run["id"],
                0 if has_fail else 1,
                result.tokens_in,
                result.tokens_out,
                result.cost_usd,
            )

            # Postgres NOTIFY so SSE listeners on the Next.js side wake up.
            await conn.execute(
                "SELECT pg_notify('synthgen_run', $1)",
                json.dumps({"runId": run["id"], "event": "job.done", "jobId": job_id}),
            )

    return conv_id
