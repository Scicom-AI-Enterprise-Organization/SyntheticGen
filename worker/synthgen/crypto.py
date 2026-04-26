"""AES-256-GCM symmetric encryption matching the Next.js TS implementation.

Wire layout: nonce (12 bytes) || tag (16 bytes) || ciphertext.
The TS side uses the same byte layout (see src/lib/crypto.ts).
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings


NONCE_LEN = 12
TAG_LEN = 16


def _load_key() -> bytes:
    raw = get_settings().app_encryption_key
    if not raw:
        raise RuntimeError(
            "APP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
        )
    # Try base64 first, then hex.
    try:
        key = base64.b64decode(raw, validate=False)
        if len(key) == 32:
            return key
    except (ValueError, base64.binascii.Error):
        pass
    try:
        key = bytes.fromhex(raw)
        if len(key) == 32:
            return key
    except ValueError:
        pass
    raise RuntimeError(
        f"APP_ENCRYPTION_KEY must decode to exactly 32 bytes (got {len(raw)} chars). "
        "Use: openssl rand -base64 32"
    )


def encrypt_secret(plaintext: str) -> bytes:
    """Encrypt a UTF-8 string. Layout matches TS encryptSecret()."""
    import os

    key = _load_key()
    aes = AESGCM(key)
    nonce = os.urandom(NONCE_LEN)
    ct_with_tag = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    # cryptography returns ciphertext || tag — split and reassemble as nonce | tag | ct.
    if len(ct_with_tag) < TAG_LEN:
        raise RuntimeError("aesgcm produced unexpectedly short output")
    ct = ct_with_tag[:-TAG_LEN]
    tag = ct_with_tag[-TAG_LEN:]
    return nonce + tag + ct


def decrypt_secret(blob: bytes | memoryview) -> str:
    """Decrypt a blob previously produced by encrypt_secret() or the TS counterpart."""
    blob = bytes(blob)
    if len(blob) < NONCE_LEN + TAG_LEN:
        raise RuntimeError("ciphertext too short")
    nonce = blob[:NONCE_LEN]
    tag = blob[NONCE_LEN : NONCE_LEN + TAG_LEN]
    ct = blob[NONCE_LEN + TAG_LEN :]
    key = _load_key()
    aes = AESGCM(key)
    plaintext = aes.decrypt(nonce, ct + tag, None)  # cryptography wants ct||tag
    return plaintext.decode("utf-8")


def fingerprint_api_key(key: str) -> str:
    """UI fingerprint matching the TS implementation."""
    last4 = key[-4:]
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]
    return f"…{last4} ({digest})"
