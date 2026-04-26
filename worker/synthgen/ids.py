"""Lightweight cuid-like ID generator compatible with Prisma's String @id columns.

Prisma generates IDs client-side; the Postgres column type is plain TEXT. Any
opaque, URL-safe identifier is fine. We use a short timestamp + random suffix
that visually resembles cuid (24 chars, lowercase alphanumeric).
"""
from __future__ import annotations

import secrets
import time


_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _b36(n: int, length: int = 0) -> str:
    if n == 0:
        return "0".rjust(length, "0")
    digits: list[str] = []
    while n:
        digits.append(_BASE36[n % 36])
        n //= 36
    s = "".join(reversed(digits))
    return s.rjust(length, "0")


def cuid_like() -> str:
    """24-char lowercase alphanumeric ID. Sortable by timestamp prefix."""
    ts = _b36(int(time.time() * 1000), 10)  # ms since epoch — ~10 chars in base36
    rand = _b36(secrets.randbits(64), 14)[:14]
    return f"c{ts}{rand}"
