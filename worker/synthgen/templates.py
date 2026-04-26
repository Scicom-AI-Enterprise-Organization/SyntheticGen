"""Mustache-style template renderer.

Supported variables (all optional — missing keys render as empty string):
  {{persona.name}}, {{persona.region}}, {{persona.urbanity}}, {{persona.ethnicity}}
  {{persona.formality}}, {{persona.age_range}}
  {{taxonomy.path}}, {{taxonomy.name}}
  {{language.primary}}, {{language.script}}, {{language.register}}
  {{difficulty}}
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


# Conservative pattern: {{ key.path }} with optional whitespace, no operators.
_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.\-]*)\s*\}\}")


def _resolve(path: str, ctx: dict[str, Any]) -> str:
    parts = path.split(".")
    node: Any = ctx
    for p in parts:
        if isinstance(node, dict):
            node = node.get(p)
        else:
            node = getattr(node, p, None)
        if node is None:
            return ""
    if isinstance(node, (list, tuple)):
        return ", ".join(str(x) for x in node)
    return str(node)


def render(template_body: str, ctx: dict[str, Any]) -> str:
    return _VAR_RE.sub(lambda m: _resolve(m.group(1), ctx), template_body)


@dataclass
class RenderContext:
    persona: dict[str, Any]
    taxonomy: dict[str, Any]
    language: dict[str, Any]
    difficulty: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "persona": self.persona,
            "taxonomy": self.taxonomy,
            "language": self.language,
            "difficulty": self.difficulty,
        }
