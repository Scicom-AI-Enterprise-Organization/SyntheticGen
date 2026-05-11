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
from .providers import chat_completion, chat_completion_stream, estimate_cost
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
        """SELECT "baseUrl", "encryptedApiKey", headers, "defaultModel", kind,
                  "reasoningEffort", "chatTemplateKwargs"
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


async def _load_knowledge_entries(
    project_id: str, node_id: str | None
) -> list[dict[str, Any]]:
    """Return KB entries that should be injected for this generation:
    - any entry with empty taxonomyNodeIds (project-wide catch-all), OR
    - entries whose taxonomyNodeIds contains the primary node_id.
    Sorted newest-first; capped at 20 so the system prompt doesn't explode.
    """
    rows = await db.fetch_all(
        '''
        SELECT id, title, content, "sourceUrl", tags, "taxonomyNodeIds"
        FROM "KnowledgeBaseEntry"
        WHERE "projectId" = $1
          AND (
            cardinality("taxonomyNodeIds") = 0
            OR ($2::text IS NOT NULL AND $2 = ANY("taxonomyNodeIds"))
          )
        ORDER BY "createdAt" DESC
        LIMIT 20
        ''',
        project_id,
        node_id,
    )
    return [dict(r) for r in rows]


def _format_knowledge_block(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return ""
    parts: list[str] = ["## Knowledge base", ""]
    for i, e in enumerate(entries, start=1):
        src = f" [source: {e['sourceUrl']}]" if e.get("sourceUrl") else ""
        parts.append(f"### {i}. {e['title']}{src}")
        parts.append(str(e.get("content") or "").strip())
        parts.append("")
    return "\n".join(parts).strip()


async def _pick_related_nodes(
    project_id: str, exclude_id: str | None, n: int
) -> list[str]:
    """Random sample N taxonomy node names from the project (excluding the
    primary). Used by the lightweight multi-topic conversation knob."""
    if n <= 0:
        return []
    rows = await db.fetch_all(
        """SELECT tn.name FROM "TaxonomyNode" tn
           JOIN "Taxonomy" t ON t.id = tn."taxonomyId"
           WHERE t."projectId" = $1
             AND ($2::text IS NULL OR tn.id <> $2)
           ORDER BY random()
           LIMIT $3""",
        project_id,
        exclude_id,
        n,
    )
    return [r["name"] for r in rows]


def _snapshot_persona(p: dict[str, Any] | None) -> dict[str, Any] | None:
    if not p:
        return None
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "ethnicity": p.get("ethnicity"),
        "region": p.get("region"),
        "urbanity": p.get("urbanity"),
        "ageRange": p.get("ageRange"),
        "formality": p.get("formality"),
        "dialectTags": list(p.get("dialectTags") or []),
    }


async def _log_event(job_id: str, kind: str, payload: dict[str, Any] | None = None) -> None:
    """Append a step in the job's trace timeline. Best-effort — never throws."""
    try:
        await db.execute(
            'INSERT INTO "JobEvent" (id, "jobId", kind, payload, ts) VALUES ($1, $2, $3, $4::jsonb, NOW())',
            cuid_like(),
            job_id,
            kind,
            json.dumps(payload) if payload else None,
        )
    except Exception:  # noqa: BLE001
        log.exception("failed to log job event %s for %s", kind, job_id)


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
        require_formal_malay=bool(lp.get("requireBahasaBaku", False)),
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

    await _log_event(
        job_id,
        "job.start",
        {"cellKey": job.get("cellKey"), "runId": run["id"], "inputContext": ctx_blob},
    )

    persona = await _load_persona(persona_id) if persona_id else None
    node = await _load_taxonomy_node(node_id) if node_id else None
    lp = await _load_language_profile(run["languageProfileId"])
    template = await _load_template(run["templateId"])
    provider = await _load_provider(run["providerCredentialId"])

    # Lightweight multi-topic: pick N additional sibling node names that the
    # template can weave into `{{taxonomy.related}}`. The conversation's primary
    # node FK doesn't change.
    related_count = int(sampling.get("relatedTopics", 0) or 0)
    related_names = (
        await _pick_related_nodes(run["projectId"], node_id, related_count)
        if related_count > 0
        else []
    )

    # Knowledge base: deterministic fetch by taxonomyNodeIds + project-wide
    # catch-alls. Becomes the {{knowledge}} template variable AND is appended
    # to the system prompt so the model sees it even if the template doesn't
    # reference {{knowledge}} explicitly.
    kb_entries = await _load_knowledge_entries(run["projectId"], node_id)
    knowledge_text = _format_knowledge_block(kb_entries)

    api_key = decrypt_secret(provider["encryptedApiKey"])
    base_url = provider["baseUrl"]
    extra_headers = _as_dict(provider.get("headers"))

    await _log_event(
        job_id,
        "context.loaded",
        {
            "persona": _snapshot_persona(persona),
            "taxonomy": (
                {
                    "id": node.get("id") if node else None,
                    "name": node.get("name") if node else None,
                    "path": node.get("path") if node else None,
                    "related": related_names,
                }
                if node
                else None
            ),
            "languageProfile": {
                "id": lp.get("id"),
                "name": lp.get("name"),
                "primary": lp.get("primary"),
                "register": lp.get("register"),
                "allowParticles": lp.get("allowParticles"),
            },
            "template": {
                "id": template.get("id"),
                "name": template.get("name"),
                "kind": template.get("kind"),
            },
            "provider": {
                "kind": provider.get("kind"),
                "baseUrl": provider.get("baseUrl"),
                "defaultModel": provider.get("defaultModel"),
            },
            "model": run["model"],
            "relatedTopicsCount": related_count,
            "knowledgeBaseMatches": len(kb_entries),
        },
    )

    if kb_entries:
        await _log_event(
            job_id,
            "knowledge.loaded",
            {
                "count": len(kb_entries),
                "entries": [
                    {
                        "id": e["id"],
                        "title": e["title"],
                        "taxonomyNodeIds": list(e.get("taxonomyNodeIds") or []),
                        "tags": list(e.get("tags") or []),
                        "sourceUrl": e.get("sourceUrl"),
                        "contentChars": len(str(e.get("content") or "")),
                    }
                    for e in kb_entries
                ],
            },
        )

    # Build the formality-aware system prompt.
    policy = _resolve_formality(
        run_policy=run.get("formalityPolicy") or "inherit",
        persona=persona,
        lp=lp,
    )
    system_text = style_guide(policy)

    taxonomy_ctx: dict[str, Any] = dict(node or {})
    # Lightweight multi-topic: list of sibling node names available as
    # `{{taxonomy.related}}` (renders as comma-joined string).
    taxonomy_ctx["related"] = related_names

    rctx = RenderContext(
        persona=(persona or {}),
        taxonomy=taxonomy_ctx,
        language={
            "primary": lp.get("primary"),
            "script": lp.get("script"),
            "register": policy.register,
        },
        difficulty=difficulty,
        knowledge=knowledge_text,
    )

    # If the template didn't opt into {{knowledge}} but we have KB entries, the
    # model would never see them. Always append to system_text so the entries
    # land in front of the model regardless of how the template is authored.
    if knowledge_text:
        system_text = (
            f"{system_text}\n\n{knowledge_text}" if system_text else knowledge_text
        )

    user_text = render(template["body"], rctx.to_dict())

    messages: list[dict[str, Any]] = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.append({"role": "user", "content": user_text})

    await _log_event(
        job_id,
        "prompt.rendered",
        {
            "systemText": system_text or "",
            "userText": user_text,
            "formality": {
                "register": policy.register,
                "allowParticles": policy.allow_particles,
                "requireFormalMalay": policy.require_formal_malay,
            },
        },
    )

    started_marker = await db.execute(
        """
        UPDATE "GenerationJob"
        SET status = 'running', attempts = attempts + 1, "startedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1
        """,
        job_id,
    )

    # Stream the assistant response so the UI can show live tokens. We also
    # emit a pg_notify('synthgen_job', ...) per delta so the per-job SSE route
    # can forward to the browser. Reasoning deltas are forwarded with
    # reasoning=true; only content deltas accumulate into the final answer.
    content_parts: list[str] = []
    reasoning_parts: list[str] = []
    reasoning_started = False
    content_started = False
    tokens_in = 0
    tokens_out = 0
    upstream_model = run["model"]
    started = __import__("time").perf_counter()
    await _log_event(
        job_id,
        "provider.request",
        {
            "url": (provider.get("baseUrl") or "").rstrip("/") + "/chat/completions",
            "model": run["model"],
            "stream": True,
            "samplingParams": {
                "temperature": sampling.get("temperature"),
                "top_p": sampling.get("top_p"),
                "max_tokens": sampling.get("max_tokens"),
                "seed": sampling.get("seed"),
            },
            "reasoningEffort": provider.get("reasoningEffort"),
            "chatTemplateKwargs": _as_dict(provider.get("chatTemplateKwargs")) or None,
        },
    )
    try:
        async with db.acquire() as ncon:
            await ncon.execute(
                "SELECT pg_notify('synthgen_job', $1)",
                json.dumps({"jobId": job_id, "runId": run["id"], "event": "start"}),
            )
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            messages=messages,
            temperature=float(sampling.get("temperature", 0.7)),
            max_tokens=sampling.get("max_tokens", 1024),
            extra_headers=extra_headers,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")) or None,
        ):
            if ev.done:
                tokens_in = ev.tokens_in
                tokens_out = ev.tokens_out
                upstream_model = ev.model or run["model"]
                break
            if ev.delta:
                if ev.reasoning:
                    if not reasoning_started:
                        reasoning_started = True
                        await _log_event(
                            job_id, "provider.stream.reasoning.start", {}
                        )
                    reasoning_parts.append(ev.delta)
                else:
                    if not content_started:
                        content_started = True
                        await _log_event(
                            job_id,
                            "provider.stream.content.start",
                            {"afterReasoningChars": sum(len(x) for x in reasoning_parts)},
                        )
                    content_parts.append(ev.delta)
                async with db.acquire() as ncon:
                    await ncon.execute(
                        "SELECT pg_notify('synthgen_job', $1)",
                        json.dumps({
                            "jobId": job_id,
                            "runId": run["id"],
                            "event": "delta",
                            "text": ev.delta,
                            "reasoning": ev.reasoning,
                        }),
                    )
    except Exception as e:  # noqa: BLE001
        log.exception("provider call failed for job=%s", job_id)
        await _log_event(job_id, "job.error", {"error": str(e)[:1000]})
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

    import time as _time
    elapsed_ms = int((_time.perf_counter() - started) * 1000)

    class _StreamedResult:
        pass

    result = _StreamedResult()
    result.content = "".join(content_parts)
    result.reasoning_content = "".join(reasoning_parts) or None
    result.tokens_in = tokens_in
    result.tokens_out = tokens_out
    result.cost_usd = estimate_cost(upstream_model, tokens_in, tokens_out)
    result.latency_ms = elapsed_ms
    result.model = upstream_model
    result.raw = {"streamed": True, "model": upstream_model}

    await _log_event(
        job_id,
        "provider.response",
        {
            "model": upstream_model,
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "latencyMs": elapsed_ms,
            "contentChars": len(result.content),
            "reasoningChars": len(result.reasoning_content or ""),
        },
    )

    async with db.acquire() as ncon:
        await ncon.execute(
            "SELECT pg_notify('synthgen_job', $1)",
            json.dumps({
                "jobId": job_id,
                "runId": run["id"],
                "event": "done",
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "latency_ms": elapsed_ms,
            }),
        )

    # Validate the assistant content.
    vctx = ValidatorContext(
        primary_language=lp.get("primary") or "ms",
        script=lp.get("script") or "latin",
        register=policy.register,
        allow_particles=policy.allow_particles,
        banned_tokens=list(lp.get("bannedTokens") or []),
        banned_patterns=list(lp.get("bannedPatterns") or []),
        require_formal_malay=policy.require_formal_malay,
        english_loanword_policy=policy.english_loanword_policy,
        loanword_allowlist=policy.loanword_allowlist,
        code_switch_policy=lp.get("codeSwitchPolicy") or "none",
        code_switch_rate=lp.get("codeSwitchRate"),
    )
    verdicts = run_pipeline(result.content, vctx)
    for v in verdicts:
        await _log_event(
            job_id,
            "validator.run",
            {
                "validatorKind": v.validator_kind,
                "axis": v.axis,
                "verdict": v.verdict,
                "score": v.score,
                "details": v.details,
            },
        )
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

    await _log_event(
        job_id,
        "conversation.persisted",
        {
            "conversationId": conv_id,
            "status": "rejected" if has_fail else "accepted",
            "primaryLanguage": primary_lang,
            "turnCount": 1,
            "tokenCount": (result.tokens_in or 0) + (result.tokens_out or 0),
        },
    )

    return conv_id
