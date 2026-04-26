"""Cheap n-gram repetition heuristic.

Catches the classic generation collapse modes (the model loops or repeats a phrase).
Not a substitute for embedding-based dedup across the dataset, just a per-sample sanity check.
"""
from __future__ import annotations

import re
from collections import Counter

from .base import ValidationResult, ValidatorContext


_WORD_RE = re.compile(r"\w+", re.UNICODE)


def _ngrams(tokens: list[str], n: int) -> list[tuple[str, ...]]:
    if len(tokens) < n:
        return []
    return [tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def validate_ngram_repetition(
    text: str,
    ctx: ValidatorContext,  # noqa: ARG001 — kept for pipeline uniformity
    n: int = 5,
    threshold: float = 0.3,
) -> list[ValidationResult]:
    tokens = [t.lower() for t in _WORD_RE.findall(text)]
    if len(tokens) < 30:
        return [
            ValidationResult(
                validator_kind="ngram-repetition",
                axis="naturalness",
                verdict="pass",
                score=1.0,
                details={"reason": "too_short_to_assess"},
            )
        ]

    grams = _ngrams(tokens, n)
    if not grams:
        return []
    counts = Counter(grams)
    most_common, freq = counts.most_common(1)[0]
    repetition_ratio = freq / len(grams)

    if repetition_ratio > threshold:
        return [
            ValidationResult(
                validator_kind="ngram-repetition",
                axis="naturalness",
                verdict="fail" if repetition_ratio > 0.5 else "warn",
                score=1.0 - repetition_ratio,
                details={
                    "n": n,
                    "ratio": round(repetition_ratio, 3),
                    "most_common_gram": " ".join(most_common),
                    "occurrences": freq,
                    "total_grams": len(grams),
                },
            )
        ]

    return [
        ValidationResult(
            validator_kind="ngram-repetition",
            axis="naturalness",
            verdict="pass",
            score=1.0 - repetition_ratio,
        )
    ]
