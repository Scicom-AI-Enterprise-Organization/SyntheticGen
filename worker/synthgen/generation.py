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
from .flow_runner import execute_flow_job
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


async def _simulate_user_turn(
    *,
    persona: dict[str, Any] | None,
    lp: dict[str, Any],
    policy: FormalityPolicy,
    transcript: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    model: str,
    extra_headers: dict[str, Any] | None,
    reasoning_effort: str | None,
    chat_template_kwargs: dict[str, Any] | None,
    max_tokens: int,
    turn_number: int = 2,
    total_turns: int = 1,
) -> tuple[str, int, int, float]:
    """Generate the next user-side utterance for a multi-turn conversation.

    The same LLM that powers the assistant is asked to role-play the *user*
    given the persona + conversation so far. Returns (text, tokens_in,
    tokens_out, cost).

    `turn_number` / `total_turns` (1-indexed) are passed in so the simulator
    knows how far through the conversation it is — early turns must keep the
    dialog going, only the last turn may bail out with "[END]" (and only if
    it's the genuinely natural place to stop).
    """
    persona_lines: list[str] = []
    if persona:
        for k in ("name", "description", "ethnicity", "region", "urbanity", "ageRange", "formality"):
            v = persona.get(k)
            if v:
                persona_lines.append(f"- {k}: {v}")
        if persona.get("dialectTags"):
            persona_lines.append(f"- dialectTags: {', '.join(persona['dialectTags'])}")
    persona_block = "\n".join(persona_lines) or "(none — use a generic Malaysian customer voice)"

    # We never invite [END] while we're still inside the planned range — even on
    # the "last" turn — because total_turns is the user-requested CONVERSATION
    # length and the model would otherwise cut it short by one turn. The loop
    # caller only honors an exact "[END]" reply as a defensive safety valve.
    sys = (
        "You are role-playing the USER side of a Malaysian customer-support conversation. "
        "Given the persona profile and conversation transcript so far, write ONLY the user's "
        "next message — 1-3 sentences, in the persona's voice and language register.\n\n"
        f"Persona:\n{persona_block}\n\n"
        f"Target language: {lp.get('primary') or 'ms'} (register: {policy.register}).\n"
        f"You are producing user turn {turn_number} of {total_turns} planned turns "
        f"({total_turns - turn_number} more turn(s) will follow after this one).\n"
        "Hard rules:\n"
        "- Reply with ONLY the user's next utterance — no role tag, no quotes, no preamble.\n"
        "- Stay in character. React naturally to the assistant's last message: ask a follow-up, "
        "  push back on something, clarify, escalate, or introduce an adjacent need.\n"
        "- Do NOT wrap the conversation up yet. The script expects you to keep going for "
        f"  {max(0, total_turns - turn_number)} more turn(s) after this one. Don't say goodbye, "
        "  don't thank-and-close, don't reply with [END]."
    )

    transcript_lines: list[str] = []
    for m in transcript:
        role = (m.get("role") or "?").upper()
        if role == "SYSTEM":
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        transcript_lines.append(f"[{role}] {content}")
    transcript_text = "\n\n".join(transcript_lines) or "(empty)"

    # The user simulator does NOT need chain-of-thought — we just want one
    # short utterance role-playing the customer. Force thinking off so a
    # reasoning model doesn't burn the whole token budget on <think>…</think>
    # and return empty `content` (which would silently drop the turn).
    sim_kwargs = dict(chat_template_kwargs or {})
    sim_kwargs["enable_thinking"] = False

    try:
        r = await chat_completion(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": f"Transcript so far:\n{transcript_text}"},
            ],
            temperature=0.8,
            # Reuse the run's max_tokens — same budget the assistant turns get,
            # so reasoning models that ignore enable_thinking still have room
            # for the visible reply after their <think> block.
            max_tokens=max_tokens,
            extra_headers=extra_headers,
            # Drop reasoning_effort for the simulator — one-shot role-play,
            # not a problem the model needs to reason about.
            reasoning_effort=None,
            chat_template_kwargs=sim_kwargs,
        )
        text = (r.content or "").strip().strip('"').strip("'")
        return text, r.tokens_in, r.tokens_out, r.cost_usd
    except Exception as e:  # noqa: BLE001
        log.warning("user simulator failed: %s", e)
        return "[END]", 0, 0, 0.0


async def _resolve_tool_names(tool_ids: list[str]) -> list[dict[str, str]]:
    """Look up tool names for a list of ToolDef ids. Tool ids that don't resolve
    are silently dropped so a deleted tool doesn't break the snapshot."""
    if not tool_ids:
        return []
    rows = await db.fetch_all(
        'SELECT id, name FROM "ToolDef" WHERE id = ANY($1::text[])',
        list(tool_ids),
    )
    out: list[dict[str, str]] = []
    for r in rows:
        out.append({"id": r["id"], "name": r["name"]})
    return out


async def _settings_snapshot(
    *,
    run: dict[str, Any],
    persona: dict[str, Any] | None,
    node: dict[str, Any] | None,
    lp: dict[str, Any],
    template: dict[str, Any] | None,
    provider: dict[str, Any],
    policy: FormalityPolicy,
    sampling: dict[str, Any],
    difficulty: str,
    mode: str,
    flow: dict[str, Any] | None = None,
    tools_invoked: list[dict[str, Any]] | None = None,
    tool_ids_override: list[str] | None = None,
) -> dict[str, Any]:
    """Build the per-conversation settings snapshot. Stored as JSON on
    Conversation.settingsSnapshot so users can answer 'what produced this row?'
    without joining back to the run (which can be edited later).
    """
    cfg = _as_dict(run.get("configSnapshot"))
    tool_ids = tool_ids_override if tool_ids_override is not None else (cfg.get("toolIds") or [])
    tool_names = await _resolve_tool_names([t for t in tool_ids if isinstance(t, str)])
    return {
        "mode": mode,
        "model": run.get("model"),
        "providerCredentialId": run.get("providerCredentialId"),
        "providerName": provider.get("name"),
        "templateId": template.get("id") if template else None,
        "templateName": template.get("name") if template else None,
        "languageProfileId": lp.get("id"),
        "languageProfileName": lp.get("name"),
        "formalityPolicy": run.get("formalityPolicy"),
        "register": policy.register,
        "samplingParams": {
            "temperature": sampling.get("temperature"),
            "top_p": sampling.get("top_p"),
            "max_tokens": sampling.get("max_tokens"),
            "seed": sampling.get("seed"),
            "turns": sampling.get("turns"),
            "relatedTopics": sampling.get("relatedTopics"),
        },
        "toolIds": [t["id"] for t in tool_names],
        "toolNames": [t["name"] for t in tool_names],
        "toolsInvoked": tools_invoked or [],
        "taxonomyNodeId": (node or {}).get("id"),
        "taxonomyNodeName": (node or {}).get("name"),
        "taxonomyNodePath": (node or {}).get("path"),
        "personaId": (persona or {}).get("id"),
        "personaName": (persona or {}).get("name"),
        "difficulty": difficulty,
        "flowId": (flow or {}).get("id"),
        "flowName": (flow or {}).get("name"),
        "flowVersion": (flow or {}).get("version"),
    }


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

    # ── Flow-driven dispatch ─────────────────────────────────────────────────
    # If the job was queued with a flowId in its inputContext, hand the rest of
    # the work off to flow_runner. It produces a multi-turn conversation that
    # walks the flow graph (invoking tools, following branches, etc.) instead
    # of the single-turn template render below.
    if ctx_blob.get("flowId"):
        if knowledge_text:
            system_text = (
                f"{system_text}\n\n{knowledge_text}" if system_text else knowledge_text
            )
        return await execute_flow_job(
            job_id=job_id,
            job=job,
            run=run,
            ctx_blob=ctx_blob,
            persona=persona,
            lp=lp,
            provider=provider,
            policy=policy,
            base_url=base_url,
            api_key=api_key,
            extra_headers=extra_headers,
            system_text=system_text,
            knowledge_text=knowledge_text,
            log_event=_log_event,
        )


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

    # ── Tool support ────────────────────────────────────────────────────────
    # Load every tool def the run made available. When the list is non-empty
    # we use the non-streaming path with `tools=…` so the model can actually
    # invoke them (chat_completion_stream doesn't support tools today). When
    # there are no tools, we keep the streaming nicety from slice 1.
    from .flow_runner import (
        _load_tool_defs,
        _tools_payload,
        _mock_tool_result,
        _normalise_tool_calls,
    )

    grid_cfg = _as_dict(run.get("configSnapshot"))
    tool_ids = [t for t in (grid_cfg.get("toolIds") or []) if isinstance(t, str)]
    tool_defs = await _load_tool_defs(tool_ids) if tool_ids else []
    tools_payload = _tools_payload(tool_defs) if tool_defs else None
    tools_by_name = {t["name"]: t for t in tool_defs}

    async def _run_turn_with_tools(
        msgs: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """One assistant turn that can invoke tools. Iterates up to 4 times:
        if the assistant emits tool_calls, we synthesize mock results via
        flow_runner._mock_tool_result, append assistant+tool messages, and ask
        for the follow-up. Returns the messages appended this turn plus tokens
        + the final content/latency.

        The streaming provider helper doesn't support tools, so this path is
        non-streaming end-to-end. To keep the Live job preview from looking
        frozen, we pg_notify 'delta' events at each step (model call begin,
        assistant content, tool call, tool result) — the UI just appends them
        as text, so the user sees progress even though tokens aren't streamed.
        """
        async def _notify(text: str) -> None:
            try:
                async with db.acquire() as ncon:
                    await ncon.execute(
                        "SELECT pg_notify('synthgen_job', $1)",
                        json.dumps({
                            "jobId": job_id,
                            "runId": run["id"],
                            "event": "delta",
                            "text": text,
                            "reasoning": False,
                        }, ensure_ascii=False),
                    )
            except Exception:  # noqa: BLE001
                pass

        new_msgs: list[dict[str, Any]] = []
        t_in = 0
        t_out = 0
        t_cost = 0.0
        last_content = ""
        last_model = run["model"]
        last_latency = 0
        for turn_i in range(4):
            await _notify(f"\n[turn {turn_i + 1}: calling {run['model']}…]\n")
            t_start = __import__("time").perf_counter()
            r = await chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                messages=msgs + new_msgs,
                tools=tools_payload,
                temperature=float(sampling.get("temperature", 0.7)),
                top_p=float(sampling.get("top_p", 1.0)),
                max_tokens=sampling.get("max_tokens", 1024),
                seed=sampling.get("seed"),
                extra_headers=extra_headers,
                reasoning_effort=provider.get("reasoningEffort"),
                chat_template_kwargs=_as_dict(provider.get("chatTemplateKwargs")) or None,
            )
            t_in += r.tokens_in
            t_out += r.tokens_out
            t_cost += r.cost_usd
            last_latency = int((__import__("time").perf_counter() - t_start) * 1000)
            last_model = r.model or run["model"]
            tc = _normalise_tool_calls(r.tool_calls) if r.tool_calls else []
            content = r.content or ""
            if content:
                await _notify(content)
            asst_msg: dict[str, Any] = {"role": "assistant", "content": content}
            if tc:
                asst_msg["tool_calls"] = tc
            asst_msg["_tokens_out"] = r.tokens_out
            asst_msg["_model"] = last_model
            asst_msg["_latency_ms"] = last_latency
            new_msgs.append(asst_msg)
            last_content = content
            if not tc:
                break
            # Mock each tool's result and append as role:tool.
            for call in tc:
                fn = call.get("function") or {}
                tname = fn.get("name") or ""
                args_text = fn.get("arguments") or "{}"
                args_preview = args_text.replace("\n", " ")
                if len(args_preview) > 120:
                    args_preview = args_preview[:120] + "…"
                await _notify(f"\n[tool call: {tname}({args_preview})]\n")
                tdef = tools_by_name.get(tname)
                if tdef is None:
                    tool_text = json.dumps(
                        {"error": f"unknown tool {tname!r}"}, ensure_ascii=False
                    )
                else:
                    tool_text = await _mock_tool_result(
                        tool_def=tdef,
                        args_text=args_text,
                        base_url=base_url,
                        api_key=api_key,
                        model=run["model"],
                        extra_headers=extra_headers,
                    )
                result_preview = tool_text.replace("\n", " ")
                if len(result_preview) > 200:
                    result_preview = result_preview[:200] + "…"
                await _notify(f"[tool result: {result_preview}]\n")
                new_msgs.append({
                    "role": "tool",
                    "tool_call_id": call.get("id") or cuid_like(),
                    "name": tname,
                    "content": tool_text,
                })
        return {
            "messages": new_msgs,
            "tokens_in": t_in,
            "tokens_out": t_out,
            "cost_usd": t_cost,
            "content": last_content,
            "model": last_model,
            "latency_ms": last_latency,
        }

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
    # Holds the assistant + tool messages produced by the FIRST turn when tools
    # are configured (streaming path can't carry tool_calls, so we use the
    # non-streaming helper).
    first_turn_extra_messages: list[dict[str, Any]] = []
    await _log_event(
        job_id,
        "provider.request",
        {
            "url": (provider.get("baseUrl") or "").rstrip("/") + "/chat/completions",
            "model": run["model"],
            "stream": tools_payload is None,
            "tools": [t["function"]["name"] for t in (tools_payload or [])],
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

    class _Result:
        pass
    result = _Result()
    result.content = ""
    result.reasoning_content = None
    result.tokens_in = 0
    result.tokens_out = 0
    result.cost_usd = 0.0
    result.latency_ms = 0
    result.model = run["model"]
    result.raw = {"streamed": tools_payload is None, "model": run["model"]}

    if tools_payload is not None:
        # ── Tool-aware first turn (non-streaming) ────────────────────────────
        # Runs an assistant call with `tools=…`. The helper iterates internally
        # when the model emits tool_calls (synthesizes a mock result per call,
        # feeds it back, repeats — capped at 4 cycles). first_turn_extra_messages
        # carries everything past the FIRST assistant content turn (tool calls
        # + tool results + any follow-up assistant content).
        # Open the Live job preview SSE before the first model call so the UI
        # flips from "Connecting…" to "Streaming…" immediately.
        try:
            async with db.acquire() as ncon:
                await ncon.execute(
                    "SELECT pg_notify('synthgen_job', $1)",
                    json.dumps({"jobId": job_id, "runId": run["id"], "event": "start"}),
                )
        except Exception:  # noqa: BLE001
            pass
        try:
            first = await _run_turn_with_tools(messages)
        except Exception as e:  # noqa: BLE001
            log.exception("provider tool call failed for job=%s", job_id)
            await _log_event(job_id, "job.error", {"error": str(e)[:1000]})
            await db.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'failed', "lastError" = $2, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id, str(e)[:1000],
            )
            raise

        first_msgs = first["messages"]
        first_assistant = next(
            (m for m in first_msgs if m.get("role") == "assistant"), None,
        )
        if first_assistant is not None:
            first_turn_extra_messages = [m for m in first_msgs if m is not first_assistant]
        else:
            first_turn_extra_messages = list(first_msgs)
        primary_content = (first_assistant or {}).get("content") or ""
        result.content = primary_content
        result.tokens_in = first["tokens_in"]
        result.tokens_out = int((first_assistant or {}).get("_tokens_out") or first["tokens_out"])
        result.cost_usd = first["cost_usd"]
        result.latency_ms = int((first_assistant or {}).get("_latency_ms") or first["latency_ms"])
        result.model = (first_assistant or {}).get("_model") or first["model"]
        tokens_in = result.tokens_in
        tokens_out = first["tokens_out"]
        upstream_model = result.model
    else:
        # ── Streaming first turn (no tools) ──────────────────────────────────
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
                            await _log_event(job_id, "provider.stream.reasoning.start", {})
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
                job_id, str(e)[:1000],
            )
            raise

        import time as _time
        elapsed_ms = int((_time.perf_counter() - started) * 1000)
        result.content = "".join(content_parts)
        result.reasoning_content = "".join(reasoning_parts) or None
        result.tokens_in = tokens_in
        result.tokens_out = tokens_out
        result.cost_usd = estimate_cost(upstream_model, tokens_in, tokens_out)
        result.latency_ms = elapsed_ms
        result.model = upstream_model
        result.raw = {"streamed": True, "model": upstream_model}

    # Use the latency the streaming branch tracked, OR result.latency_ms which
    # the tool-aware branch sets directly. Both should be populated by now.
    elapsed_ms = result.latency_ms

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

    # NOTE: we DO NOT emit the SSE `done` event here yet — the multi-turn loop
    # below may produce more deltas, and the SSE route closes the stream as
    # soon as it sees `done`. Emit a `turn.end` instead so the listener stays
    # subscribed; the final `done` is sent after the loop completes.
    async with db.acquire() as ncon:
        await ncon.execute(
            "SELECT pg_notify('synthgen_job', $1)",
            json.dumps({
                "jobId": job_id,
                "runId": run["id"],
                "event": "turn.end",
                "turn": 1,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "latency_ms": elapsed_ms,
            }),
        )

    # Helper so the multi-turn loop can push deltas onto the same SSE channel,
    # mirroring the per-token deltas the streaming first turn already emits.
    async def _notify_delta(text: str, reasoning: bool = False) -> None:
        if not text:
            return
        try:
            async with db.acquire() as ncon:
                await ncon.execute(
                    "SELECT pg_notify('synthgen_job', $1)",
                    json.dumps({
                        "jobId": job_id,
                        "runId": run["id"],
                        "event": "delta",
                        "text": text,
                        "reasoning": reasoning,
                    }, ensure_ascii=False),
                )
        except Exception:  # noqa: BLE001
            pass

    # ── Multi-turn continuation ──────────────────────────────────────────────
    # `samplingParams.turns` is the user-requested number of user→assistant
    # exchanges. The first turn is already done above; loop turns 2..N. Each
    # iteration:
    #   1. Asks a user-simulator LLM (same provider/model, role-playing the
    #      persona) for the next user message. If it returns "[END]" we stop.
    #   2. Calls the assistant for the next reply (non-streamed — UI already
    #      committed the conversation start; further turns land on refresh).
    #
    # All extra messages collected here get persisted alongside the first turn.
    target_turns = max(1, int(sampling.get("turns", 1) or 1))
    await _log_event(
        job_id,
        "turn.plan",
        {
            "targetTurns": target_turns,
            "configuredTurns": sampling.get("turns"),
            "toolMode": tools_payload is not None,
        },
    )
    chat_template_kwargs_arg = _as_dict(provider.get("chatTemplateKwargs")) or None
    # `extra_messages` accumulates EVERY message past the first user+assistant
    # pair: tool calls/results synthesized during turn 1 plus all turns 2..N.
    extra_messages: list[dict[str, Any]] = list(first_turn_extra_messages)

    # Live transcript fed to both the user simulator and the next assistant call.
    # Includes the system prompt + first user + first assistant + any tool calls
    # and tool results synthesized during turn 1, so the simulator and the next
    # assistant turn both see real tool output.
    transcript: list[dict[str, Any]] = list(messages) + [
        {"role": "assistant", "content": result.content},
    ] + [
        # Strip our internal `_tokens_out` / `_model` / `_latency_ms` markers
        # before sending to the provider — those are persistence metadata only.
        {k: v for k, v in m.items() if not k.startswith("_")}
        for m in first_turn_extra_messages
    ]
    total_tokens_in = tokens_in
    total_tokens_out = tokens_out
    total_cost = result.cost_usd
    last_assistant_content = result.content
    last_assistant_model = result.model
    last_assistant_tokens_out = result.tokens_out
    last_assistant_latency = result.latency_ms

    for turn_i in range(2, target_turns + 1):
        user_text_next, sim_in, sim_out, sim_cost = await _simulate_user_turn(
            persona=persona,
            lp=lp,
            policy=policy,
            transcript=transcript,
            base_url=base_url,
            api_key=api_key,
            model=run["model"],
            extra_headers=extra_headers,
            reasoning_effort=provider.get("reasoningEffort"),
            chat_template_kwargs=chat_template_kwargs_arg,
            max_tokens=int(sampling.get("max_tokens") or 1024),
            turn_number=turn_i,
            total_turns=target_turns,
        )
        total_tokens_in += sim_in
        total_tokens_out += sim_out
        total_cost += sim_cost
        await _log_event(
            job_id,
            "turn.user.simulated",
            {"turn": turn_i, "text": user_text_next, "tokensIn": sim_in, "tokensOut": sim_out},
        )
        stripped = user_text_next.strip()
        # Defensive: if the model still emits the [END] sentinel despite the
        # prompt forbidding it inside the planned range, strip the marker and
        # keep whatever content follows so we don't lose the turn. Only break
        # if NOTHING usable remains.
        if stripped.startswith("[END]"):
            stripped = stripped[len("[END]"):].lstrip(" .,:;—-").strip()
            await _log_event(
                job_id,
                "turn.user.end_sentinel_stripped",
                {"turn": turn_i, "remaining_chars": len(stripped)},
            )
        if not stripped:
            # Simulator returned nothing usable (reasoning model burned its
            # budget on <think>, or template stripped the answer). Don't drop
            # the turn — sub in a neutral follow-up so the conversation keeps
            # its planned length. We log it so the trace shows the fallback.
            stripped = "Boleh terangkan lagi?"
            await _log_event(
                job_id,
                "turn.user.empty",
                {"turn": turn_i, "fallback": stripped},
            )
        user_text_next = stripped

        # Surface the simulated user turn on the live preview SSE channel so
        # the UI shows progress between assistant calls.
        await _notify_delta(f"\n\n[user · turn {turn_i}] {user_text_next}\n\n")

        extra_messages.append({"role": "user", "content": user_text_next})
        transcript.append({"role": "user", "content": user_text_next})

        try:
            if tools_payload is not None:
                # Use the tool-aware helper so the model can invoke tools here too.
                next_first = await _run_turn_with_tools(transcript)
                turn_msgs = next_first["messages"]
                turn_tokens_in = next_first["tokens_in"]
                turn_tokens_out = next_first["tokens_out"]
                turn_cost = next_first["cost_usd"]
                turn_latency = next_first["latency_ms"]
                # Append every assistant/tool message to extra_messages + transcript.
                for m in turn_msgs:
                    extra_messages.append(m)
                    transcript.append({k: v for k, v in m.items() if not k.startswith("_")})
                # Track the LAST assistant content for validation / closing.
                final_assistant = next(
                    (m for m in reversed(turn_msgs) if m.get("role") == "assistant"),
                    None,
                )
                if final_assistant is not None:
                    last_assistant_content = final_assistant.get("content") or ""
                    last_assistant_model = final_assistant.get("_model") or run["model"]
                    last_assistant_tokens_out = int(final_assistant.get("_tokens_out") or 0)
                    last_assistant_latency = int(final_assistant.get("_latency_ms") or turn_latency)
                total_tokens_in += turn_tokens_in
                total_tokens_out += turn_tokens_out
                total_cost += turn_cost
                await _log_event(
                    job_id,
                    "turn.assistant",
                    {
                        "turn": turn_i,
                        "model": last_assistant_model,
                        "tokensIn": turn_tokens_in,
                        "tokensOut": turn_tokens_out,
                        "latencyMs": turn_latency,
                        "contentChars": len(last_assistant_content),
                        "withTools": True,
                    },
                )
                continue

            # Tool-less path: a single chat_completion.
            t_start = __import__("time").perf_counter()
            next_resp = await chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=run["model"],
                messages=transcript,
                temperature=float(sampling.get("temperature", 0.7)),
                top_p=float(sampling.get("top_p", 1.0)),
                max_tokens=sampling.get("max_tokens", 1024),
                seed=sampling.get("seed"),
                extra_headers=extra_headers,
                reasoning_effort=provider.get("reasoningEffort"),
                chat_template_kwargs=chat_template_kwargs_arg,
            )
            turn_latency = int((__import__("time").perf_counter() - t_start) * 1000)
        except Exception as e:  # noqa: BLE001
            log.warning("turn %s assistant call failed: %s", turn_i, e)
            await _log_event(job_id, "turn.error", {"turn": turn_i, "error": str(e)[:500]})
            break

        total_tokens_in += next_resp.tokens_in
        total_tokens_out += next_resp.tokens_out
        total_cost += next_resp.cost_usd
        last_assistant_content = next_resp.content or ""
        last_assistant_model = next_resp.model or run["model"]
        last_assistant_tokens_out = next_resp.tokens_out
        last_assistant_latency = turn_latency

        # Push the assistant content onto the live preview as a single chunk
        # (chat_completion is non-streaming so we don't have token-level deltas).
        await _notify_delta(f"[assistant · turn {turn_i}]\n{last_assistant_content}\n")

        extra_messages.append({
            "role": "assistant",
            "content": last_assistant_content,
            "_tokens_out": next_resp.tokens_out,
            "_model": last_assistant_model,
            "_latency_ms": turn_latency,
        })
        transcript.append({"role": "assistant", "content": last_assistant_content})

        await _log_event(
            job_id,
            "turn.assistant",
            {
                "turn": turn_i,
                "model": last_assistant_model,
                "tokensIn": next_resp.tokens_in,
                "tokensOut": next_resp.tokens_out,
                "latencyMs": turn_latency,
                "contentChars": len(last_assistant_content),
                "withTools": False,
            },
        )

    # Multi-turn loop is done — close the SSE stream with a final `done` event
    # carrying the rolled-up token counters across every turn.
    async with db.acquire() as ncon:
        await ncon.execute(
            "SELECT pg_notify('synthgen_job', $1)",
            json.dumps({
                "jobId": job_id,
                "runId": run["id"],
                "event": "done",
                "tokens_in": total_tokens_in,
                "tokens_out": total_tokens_out,
                "latency_ms": last_assistant_latency,
            }),
        )

    actual_user_turns = 1 + sum(1 for m in extra_messages if m.get("role") == "user")
    # Used by validators + persistence below. We deliberately validate the LAST
    # assistant turn (most reflective of how the conversation finishes); per-turn
    # validation can land later if needed.
    final_assistant_content = last_assistant_content

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
    verdicts = run_pipeline(final_assistant_content, vctx)
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

    settings_snapshot = await _settings_snapshot(
        run=run,
        persona=persona,
        node=node,
        lp=lp,
        template=template,
        provider=provider,
        policy=policy,
        sampling=sampling,
        difficulty=difficulty,
        mode="single-turn",
    )

    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO "Conversation" (
                    id, "projectId", "runId", "taxonomyNodeId", "personaId",
                    "primaryLanguage", "primaryScript", difficulty, "turnCount",
                    "tokenCount", status, "dedupHash", "settingsSnapshot",
                    "createdAt", "updatedAt"
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    $10, $11, $12, $13::jsonb,
                    NOW(), NOW()
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
                actual_user_turns,
                total_tokens_in + total_tokens_out,
                "rejected" if has_fail else "accepted",
                _content_hash(final_assistant_content),
                json.dumps(settings_snapshot, ensure_ascii=False),
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
            ordinal += 1

            # Persist any extra messages: tool calls / tool results from the
            # first turn plus all turns 2..N (user simulation, assistant, and
            # any nested tool-call loops).
            for m in extra_messages:
                role = m.get("role")
                content = m.get("content") or ""
                if role == "user":
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content, "createdAt")
                           VALUES ($1, $2, $3, 'user', $4, NOW())""",
                        cuid_like(), conv_id, ordinal, content,
                    )
                elif role == "assistant":
                    tool_calls_json = (
                        json.dumps(m["tool_calls"], ensure_ascii=False)
                        if m.get("tool_calls")
                        else None
                    )
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content, "toolCalls",
                            language, script, "tokenCount", "latencyMs", model, "createdAt")
                           VALUES ($1, $2, $3, 'assistant', $4, $5::jsonb, $6, $7, $8, $9, $10, NOW())""",
                        cuid_like(),
                        conv_id,
                        ordinal,
                        content,
                        tool_calls_json,
                        primary_lang,
                        lp.get("script") or "latin",
                        int(m.get("_tokens_out") or 0),
                        int(m.get("_latency_ms") or 0),
                        m.get("_model") or run["model"],
                    )
                elif role == "tool":
                    await conn.execute(
                        """INSERT INTO "Message"
                           (id, "conversationId", ordinal, role, content, "toolCallId", "createdAt")
                           VALUES ($1, $2, $3, 'tool', $4, $5, NOW())""",
                        cuid_like(),
                        conv_id,
                        ordinal,
                        content,
                        m.get("tool_call_id"),
                    )
                ordinal += 1

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
                total_tokens_in, total_tokens_out, total_cost, last_assistant_latency,
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
                total_tokens_in,
                total_tokens_out,
                total_cost,
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
            "turnCount": actual_user_turns,
            "tokenCount": (total_tokens_in or 0) + (total_tokens_out or 0),
        },
    )

    return conv_id
