"""Project bootstrap — seed default LanguageProfile rows when a new project is created.

Called by the FastAPI internal endpoint POST /internal/projects/{id}/bootstrap.
Idempotent: skips presets whose `name` already exists for the project.
"""
from __future__ import annotations

from . import db
from .ids import cuid_like
from .presets import LANGUAGE_PROFILE_PRESETS


async def bootstrap_project_defaults(project_id: str) -> int:
    """Insert any missing language profile presets for the given project.

    Returns the number of newly created rows.
    """
    existing_rows = await db.fetch_all(
        """SELECT name FROM "LanguageProfile" WHERE "projectId" = $1""",
        project_id,
    )
    existing = {r["name"] for r in existing_rows}

    created = 0
    for preset in LANGUAGE_PROFILE_PRESETS:
        if preset.name in existing:
            continue
        await db.execute(
            """
            INSERT INTO "LanguageProfile" (
                id, "projectId", name, "primary", secondary, script,
                "codeSwitchPolicy", "codeSwitchRate",
                register, "allowParticles",
                "bannedTokens", "bannedPatterns", "requireBahasaBaku",
                "englishLoanwordPolicy", "loanwordAllowlist",
                "dialectHints", "formalityDefault", notes,
                "isPreset", "createdAt", "updatedAt"
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8,
                $9, $10,
                $11, $12, $13,
                $14, $15,
                $16, $17, $18,
                TRUE, NOW(), NOW()
            )
            """,
            cuid_like(),
            project_id,
            preset.name,
            preset.primary,
            preset.secondary,
            preset.script,
            preset.code_switch_policy,
            preset.code_switch_rate,
            preset.register,
            preset.allow_particles,
            preset.banned_tokens,
            preset.banned_patterns,
            preset.require_bahasa_baku,
            preset.english_loanword_policy,
            preset.loanword_allowlist,
            preset.dialect_hints,
            preset.formality_default,
            preset.notes,
        )
        created += 1
    return created
