"""Register-compliance validator — the enterprise (TM-style) enforcement layer.

Catches Manglish particles, SMS shortcuts, and unallowed English loanwords. This is
the cheap-but-load-bearing piece that makes formal Bahasa Baku datasets actually formal.
"""
from __future__ import annotations

import re

from ..malay_words import is_likely_malay
from ..presets import BAHASA_BAKU_SHORTCUTS
from .base import ValidationResult, ValidatorContext


# Cache compiled patterns per validator-context (keyed by tuple of banned terms)
# to avoid rebuilding on every call without leaking memory across workers.
_PATTERN_CACHE: dict[tuple[str, ...], re.Pattern[str]] = {}


def _compile_word_blocklist(words: list[str]) -> re.Pattern[str] | None:
    if not words:
        return None
    key = tuple(sorted(set(w.lower() for w in words)))
    cached = _PATTERN_CACHE.get(key)
    if cached:
        return cached
    escaped = "|".join(re.escape(w) for w in key)
    pat = re.compile(rf"\b({escaped})\b", re.IGNORECASE)
    _PATTERN_CACHE[key] = pat
    return pat


_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÿĀ-ɏ]+")


def _english_words(text: str) -> list[str]:
    """Cheap English-token approximation: ASCII alphabetic 3+ letters."""
    return [t for t in _TOKEN_RE.findall(text) if t.isascii() and t.isalpha() and len(t) >= 3]


def validate_register_compliance(text: str, ctx: ValidatorContext) -> list[ValidationResult]:
    results: list[ValidationResult] = []

    # 1. Banned tokens (Manglish particles when allow_particles=False).
    if ctx.banned_tokens and not ctx.allow_particles:
        pat = _compile_word_blocklist(ctx.banned_tokens)
        if pat:
            hits = pat.findall(text)
            if hits:
                results.append(
                    ValidationResult(
                        validator_kind="register-compliance",
                        axis="register",
                        verdict="fail",
                        details={
                            "reason": "banned_particles",
                            "hits": list(set(h.lower() for h in hits)),
                            "count": len(hits),
                        },
                    )
                )

    # 2. Banned regex patterns (project-defined).
    for raw in ctx.banned_patterns:
        try:
            pattern = re.compile(raw, re.IGNORECASE)
        except re.error:
            continue
        if pattern.search(text):
            results.append(
                ValidationResult(
                    validator_kind="register-compliance",
                    axis="register",
                    verdict="fail",
                    details={"reason": "banned_pattern", "pattern": raw},
                )
            )

    # 3. Bahasa Baku — reject SMS shortcuts when enforced.
    if ctx.require_bahasa_baku and ctx.primary_language == "ms":
        pat = _compile_word_blocklist(BAHASA_BAKU_SHORTCUTS)
        if pat:
            hits = pat.findall(text)
            if hits:
                results.append(
                    ValidationResult(
                        validator_kind="register-compliance",
                        axis="register",
                        verdict="fail",
                        details={
                            "reason": "bahasa_baku_shortcut",
                            "hits": list(set(h.lower() for h in hits)),
                            "count": len(hits),
                        },
                    )
                )

    # 4. English loanword policy — only meaningful when primary language is non-English.
    if ctx.primary_language != "en" and ctx.english_loanword_policy in {"forbid", "allowlist"}:
        en_tokens = _english_words(text)
        allow = {w.lower() for w in ctx.loanword_allowlist}
        # Filter out: configured allowlist + common Malay function words (the naive
        # ASCII check would otherwise mis-flag "saya", "selamat", "untuk" etc as English).
        offenders = [
            t for t in en_tokens
            if t.lower() not in allow and not is_likely_malay(t)
        ]
        if ctx.english_loanword_policy == "forbid" and offenders:
            results.append(
                ValidationResult(
                    validator_kind="register-compliance",
                    axis="register",
                    verdict="fail",
                    details={
                        "reason": "english_loanword_forbidden",
                        "samples": offenders[:10],
                        "count": len(offenders),
                    },
                )
            )
        elif ctx.english_loanword_policy == "allowlist" and offenders:
            # Allowlist is advisory: warn rather than fail to avoid false positives
            # on Malay words that look like English (cinta, data, bil, etc.).
            results.append(
                ValidationResult(
                    validator_kind="register-compliance",
                    axis="register",
                    verdict="warn",
                    details={
                        "reason": "english_loanword_outside_allowlist",
                        "samples": offenders[:10],
                        "count": len(offenders),
                    },
                )
            )

    if not results:
        results.append(
            ValidationResult(
                validator_kind="register-compliance",
                axis="register",
                verdict="pass",
                score=1.0,
            )
        )

    return results
