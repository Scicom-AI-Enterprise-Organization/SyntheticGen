"""Synchronous validator pipeline.

Cheap → expensive ordering, short-circuits on hard fails. Each validator returns one
or more ValidationResult records that get persisted as Validation rows.

Slice 1 ships: schema, lang_id, register, ngram. Judge LLMs are deferred to slice 2.
"""
from .base import ValidationResult, ValidatorContext
from .lang_id import validate_language
from .ngram import validate_ngram_repetition
from .register import validate_register_compliance
from .schema import validate_schema

__all__ = [
    "ValidationResult",
    "ValidatorContext",
    "validate_language",
    "validate_ngram_repetition",
    "validate_register_compliance",
    "validate_schema",
    "run_pipeline",
]


def run_pipeline(text: str, ctx: ValidatorContext) -> list[ValidationResult]:
    """Run the cheap validator pipeline in order. Returns all verdicts (including warns)."""
    results: list[ValidationResult] = []

    # 1. Schema / structural sanity (placeholder — slice 1 has no tool calls).
    results.extend(validate_schema(text, ctx))

    # 2. Language identification — populates ctx.detected_language for downstream.
    lang_results = validate_language(text, ctx)
    results.extend(lang_results)

    # 3. Register compliance — Manglish particle ban, Bahasa Baku, loanword policy.
    results.extend(validate_register_compliance(text, ctx))

    # 4. Repetition / quality heuristics.
    results.extend(validate_ngram_repetition(text, ctx))

    return results
