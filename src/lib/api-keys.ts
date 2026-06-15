import crypto from "node:crypto";

// Personal-access-token helpers. Tokens look like
//   sgk_<24 url-safe base64 chars>
// the `sgk_` ("SyntheticGen Key") prefix lets us spot accidental token leaks
// in logs/repos. We store sha256(rawToken) plus the first 12 chars of the
// raw string for display.
//
// Why sha256 and not bcrypt: API tokens are high-entropy random bytes, not
// user-chosen passwords. The brute-force surface is irrelevant — what matters
// is that a DB leak doesn't surrender working credentials, which sha256
// already provides. Same model as GitHub PATs.

const TOKEN_PREFIX = "sgk_";
const TOKEN_BYTE_LEN = 24; // → 32 base64url chars

export interface MintedToken {
  /** The raw token to hand to the user ONCE. */
  raw: string;
  /** First 12 chars of `raw` — safe to show in the UI list. */
  prefix: string;
  /** sha256 of `raw` — store this. */
  hashed: string;
}

export function mintApiToken(): MintedToken {
  const raw =
    TOKEN_PREFIX +
    crypto
      .randomBytes(TOKEN_BYTE_LEN)
      .toString("base64url")
      .replace(/=/g, "");
  return {
    raw,
    prefix: raw.slice(0, 12),
    hashed: hashApiToken(raw),
  };
}

export function hashApiToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Pulls a bearer token out of a Request without throwing. Returns null if
 *  the header is absent, malformed, or not a `Bearer` scheme. */
export function bearerTokenFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)/i.exec(h);
  if (!m) return null;
  return m[1];
}
