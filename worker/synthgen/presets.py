"""Malaysia language profile presets and the canonical Manglish/Bahasa-Baku word lists.

This is the SOURCE OF TRUTH for these lists. The TS frontend never embeds them —
project bootstrap calls into Python over HTTP to seed defaults, and validators
in the worker reference these constants directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field


# Manglish / Bahasa Rojak particle blocklist for enterprise formal datasets.
# Validators perform word-bounded, case-insensitive match.
# Excluded deliberately:
#   "ke"  — legit MS preposition ("log masuk ke portal")
#   "kan" — legit MS verb suffix ("kembalikan")
#   "tau" — legit MS verb ("tahu" colloquial form, but also a name particle)
# Projects can re-add these via the LanguageProfile editor when context demands.
MANGLISH_PARTICLES: list[str] = [
    "lah", "lor", "leh", "meh", "kot", "wei", "doh", "weh",
    "eh", "mah", "deh", "geh", "bah",
]

# SMS / colloquial shortcuts that fail Bahasa Baku spelling rules.
BAHASA_BAKU_SHORTCUTS: list[str] = [
    "tak", "je", "dah", "mcm", "byk", "dgn", "pd", "utk", "yg", "tu", "ni",
    "kt", "sbb", "skrg", "jgn", "tgk", "btw", "tq", "thx",
]

# Telco-domain English loanwords typically allowed in formal MS enterprise contexts.
TELCO_LOANWORD_ALLOWLIST: list[str] = [
    "router", "modem", "bil", "bandwidth", "internet", "wifi", "fiber", "fibre",
    "broadband", "hotspot", "data", "sim", "kuota", "plan", "package", "billing",
    "portal", "login", "password", "username", "email", "sms",
]


@dataclass(frozen=True)
class LanguageProfilePreset:
    name: str
    primary: str
    secondary: list[str]
    script: str = "latin"
    code_switch_policy: str = "none"
    code_switch_rate: float | None = None
    register: str = "formal"
    allow_particles: bool = False
    banned_tokens: list[str] = field(default_factory=list)
    banned_patterns: list[str] = field(default_factory=list)
    require_bahasa_baku: bool = False
    english_loanword_policy: str = "free"
    loanword_allowlist: list[str] = field(default_factory=list)
    dialect_hints: list[str] = field(default_factory=list)
    formality_default: str | None = None
    notes: str | None = None


LANGUAGE_PROFILE_PRESETS: list[LanguageProfilePreset] = [
    LanguageProfilePreset(
        name="Malaysia – Enterprise Formal (TM-style)",
        primary="ms",
        secondary=["en"],
        script="latin",
        code_switch_policy="inter-sentential",
        code_switch_rate=0.15,
        register="formal",
        allow_particles=False,
        banned_tokens=list(MANGLISH_PARTICLES),
        banned_patterns=[],
        require_bahasa_baku=True,
        english_loanword_policy="allowlist",
        loanword_allowlist=list(TELCO_LOANWORD_ALLOWLIST),
        dialect_hints=[],
        formality_default="formal",
        notes=(
            "Formal Bahasa Melayu Baku for telco / enterprise customer support. "
            "No Manglish particles. Limited English loanwords for technical terms."
        ),
    ),
    LanguageProfilePreset(
        name="Malaysia – Casual (Manglish OK)",
        primary="ms",
        secondary=["en", "zh"],
        script="latin",
        code_switch_policy="intra-sentential",
        code_switch_rate=0.4,
        register="colloquial",
        allow_particles=True,
        banned_tokens=[],
        banned_patterns=[],
        require_bahasa_baku=False,
        english_loanword_policy="free",
        loanword_allowlist=[],
        dialect_hints=["manglish"],
        formality_default="colloquial",
        notes=(
            "Casual Malaysian register with full Bahasa Rojak. "
            "Manglish particles (lah/lor/meh) and English code-switching are encouraged."
        ),
    ),
]
