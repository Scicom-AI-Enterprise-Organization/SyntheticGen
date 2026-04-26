"""Structural / schema validators.

Slice 1 has no tool calls, so the only check here is that the assistant produced
non-empty content. Tool-arg JSON-Schema validation lands when tool calling does.
"""
from __future__ import annotations

from .base import ValidationResult, ValidatorContext


def validate_schema(text: str, ctx: ValidatorContext) -> list[ValidationResult]:
    text_stripped = text.strip()
    if not text_stripped:
        return [
            ValidationResult(
                validator_kind="schema",
                axis="correctness",
                verdict="fail",
                details={"reason": "empty_response"},
            )
        ]
    if len(text_stripped) > 50_000:
        return [
            ValidationResult(
                validator_kind="schema",
                axis="correctness",
                verdict="warn",
                details={"reason": "very_long_response", "length": len(text_stripped)},
            )
        ]
    return [
        ValidationResult(
            validator_kind="schema",
            axis="correctness",
            verdict="pass",
            score=1.0,
        )
    ]
