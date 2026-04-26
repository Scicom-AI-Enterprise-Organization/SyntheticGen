"""Language identification using lingua-py.

Lingua handles short Malay strings and the MS↔ID disambiguation better than franc/cld3.
Lazy-instantiated so workers don't pay startup cost when not needed.
"""
from __future__ import annotations

from functools import lru_cache

from .base import ValidationResult, ValidatorContext


# ISO 639-1 → lingua Language enum name. Restricting the language set sharpens
# detection (lingua docs recommend this) and keeps memory footprint small.
_ISO_TO_LINGUA = {
    "ms": "MALAY",
    "en": "ENGLISH",
    "zh": "CHINESE",
    "ta": "TAMIL",
    "id": "INDONESIAN",  # disambiguator — Bahasa Indonesia is structurally close to MS.
}


@lru_cache(maxsize=1)
def _detector():
    from lingua import Language, LanguageDetectorBuilder

    languages = [getattr(Language, name) for name in _ISO_TO_LINGUA.values()]
    return LanguageDetectorBuilder.from_languages(*languages).build()


def _to_iso(name: str | None) -> str | None:
    if not name:
        return None
    inv = {v: k for k, v in _ISO_TO_LINGUA.items()}
    return inv.get(name)


def detect_primary(text: str) -> tuple[str | None, float | None]:
    if not text.strip():
        return None, None
    det = _detector()
    confidence_values = det.compute_language_confidence_values(text)
    if not confidence_values:
        return None, None
    top = confidence_values[0]
    return _to_iso(top.language.name), float(top.value)


def validate_language(text: str, ctx: ValidatorContext) -> list[ValidationResult]:
    iso, confidence = detect_primary(text)
    ctx.detected_language = iso
    ctx.detected_confidence = confidence

    if iso is None:
        return [
            ValidationResult(
                validator_kind="langid",
                axis="language-fidelity",
                verdict="warn",
                details={"reason": "no_detection"},
            )
        ]

    matches_target = iso == ctx.primary_language
    # Treat MS↔ID confusion as a warning, not a fail — lingua mis-classifies short MS as ID often.
    cross_lingual_close = (
        not matches_target and {iso, ctx.primary_language} == {"ms", "id"}
    )

    if matches_target:
        verdict = "pass"
    elif ctx.code_switch_policy in {"intra-sentential", "rojak", "inter-sentential"} and iso in {"en", "zh", "ta"}:
        # Mixed-language outputs are expected when code-switching is allowed.
        verdict = "warn"
    elif cross_lingual_close:
        verdict = "warn"
    else:
        verdict = "fail"

    return [
        ValidationResult(
            validator_kind="langid",
            axis="language-fidelity",
            verdict=verdict,
            score=confidence,
            details={
                "detected": iso,
                "target": ctx.primary_language,
                "confidence": confidence,
            },
        )
    ]
