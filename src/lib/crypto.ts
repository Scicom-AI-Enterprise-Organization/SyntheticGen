import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Layout: nonce (12 bytes) | tag (16 bytes) | ciphertext.
// Same byte layout is consumed by the Python worker (cryptography.hazmat AES-GCM).
const NONCE_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  // Tolerate base64 (preferred) or hex.
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("not 32 bytes");
  } catch {
    key = Buffer.from(raw, "hex");
  }
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Use: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): Buffer {
  const key = loadKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ct]);
}

export function decryptSecret(blob: Buffer): string {
  const key = loadKey();
  if (blob.length < NONCE_LEN + TAG_LEN) {
    throw new Error("Ciphertext too short");
  }
  const nonce = blob.subarray(0, NONCE_LEN);
  const tag = blob.subarray(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ct = blob.subarray(NONCE_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * UI fingerprint: last-4 of the key + a short hash. Stable; safe to display.
 */
export function fingerprintApiKey(key: string): string {
  const last4 = key.slice(-4);
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `…${last4} (${hash})`;
}
