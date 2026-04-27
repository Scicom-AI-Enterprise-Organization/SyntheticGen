"""Auto-injected system-prompt fragment derived from the resolved formality policy.

Belt-and-braces with the register-compliance validator: the prompt reduces violations,
the validator catches what slips through. Without the prompt injection we waste tokens
on regenerations.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FormalityPolicy:
    register: str
    allow_particles: bool
    require_formal_malay: bool
    english_loanword_policy: str
    loanword_allowlist: list[str]
    primary: str


def style_guide(policy: FormalityPolicy) -> str:
    lines: list[str] = []

    if policy.register == "formal":
        if policy.primary == "ms":
            lines.append("Respond in Formal Malay.")
            if policy.require_formal_malay:
                lines.append(
                    "Use full standard spelling (e.g. 'tidak' not 'tak', 'sahaja' not 'je', "
                    "'sudah' not 'dah'). Do not use SMS shortcuts."
                )
        elif policy.primary == "en":
            lines.append("Respond in formal English appropriate for enterprise customer support.")
        else:
            lines.append("Respond in a formal register.")
    elif policy.register == "semi-formal":
        lines.append("Respond in a polite, professional tone with light contractions allowed.")
    elif policy.register == "colloquial":
        lines.append("Respond in a casual, conversational Malaysian register.")

    if not policy.allow_particles:
        lines.append(
            "Do not use Manglish/Bahasa Rojak particles such as 'lah', 'lor', 'meh', "
            "'kan', 'kot', 'wei', 'doh', 'eh', 'ah', 'ke', 'leh', 'mah'."
        )

    if policy.english_loanword_policy == "forbid" and policy.primary != "en":
        lines.append("Do not use English loanwords. Translate all technical terms.")
    elif policy.english_loanword_policy == "allowlist" and policy.primary != "en":
        if policy.loanword_allowlist:
            lines.append(
                "Only the following English loanwords are permitted: "
                + ", ".join(policy.loanword_allowlist)
                + ". Avoid other English words."
            )
        else:
            lines.append(
                "Avoid English loanwords unless strictly necessary for technical accuracy."
            )

    return " ".join(lines)
