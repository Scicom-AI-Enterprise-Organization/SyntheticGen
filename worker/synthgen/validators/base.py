"""Validator data types."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


Verdict = str  # "pass" | "fail" | "warn"


@dataclass
class ValidationResult:
    validator_kind: str
    axis: str
    verdict: Verdict
    score: float | None = None
    details: dict[str, Any] | None = None
    judge_model: str | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None


@dataclass
class ValidatorContext:
    """Per-conversation context passed to every validator.

    Mirrors the resolved language profile + persona for the conversation under
    inspection. The validator pipeline mutates `detected_language` once lang-ID
    runs so later validators (e.g. register) can use it.
    """

    primary_language: str  # ms | en | zh | ta
    script: str
    register: str
    allow_particles: bool
    banned_tokens: list[str]
    banned_patterns: list[str]
    require_bahasa_baku: bool
    english_loanword_policy: str
    loanword_allowlist: list[str]
    code_switch_policy: str
    code_switch_rate: float | None
    detected_language: str | None = None
    detected_confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
