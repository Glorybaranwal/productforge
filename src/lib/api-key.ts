/**
 * Workspace API keys, the pure half (PF-083, ADR-036): minting, parsing, hashing and comparing. No
 * database, no logging, and nothing here ever stores a secret. Everything is `node:crypto`.
 *
 * Format: `pf_<env>_<prefix>_<secret>`. `<env>` is `live` or `test`; `<prefix>` is eight lowercase
 * base32 characters, used for lookup and log correlation and not secret; `<secret>` is 32 random bytes
 * in base64url (43 characters, and it may itself contain `_`, which is why every part has a fixed
 * length and the key is matched as a whole rather than split on underscores). The client sends it as
 * `Authorization: Bearer <key>`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;
/** 32 bytes in base64url, unpadded. */
const SECRET_LENGTH = 43;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
/** The longest header worth looking at; a real key is 4 + 1 + 8 + 1 + 43 + "Bearer " = ~66. */
const MAX_HEADER_LENGTH = 200;

const KEY_PATTERN = new RegExp(
  `^pf_(?:live|test)_([a-z2-7]{${KEY_PREFIX_LENGTH}})_([A-Za-z0-9_-]{${SECRET_LENGTH}})$`,
);
const SCHEME = "bearer ";

export type KeyEnv = "live" | "test";

/** Eight base32 characters from five random bytes (5 bytes = 40 bits = 8 x 5 bits, no bias). */
function randomPrefix(): string {
  const bytes = randomBytes(5);
  // 40 bits fit exactly in a double, so plain arithmetic is safe here.
  const bits = bytes.reduce((acc, byte) => acc * 256 + byte, 0);
  let out = "";
  for (let i = 7; i >= 0; i--) out += BASE32[Math.floor(bits / 32 ** i) % 32];
  return out;
}

/** SHA-256 of the secret part, as lowercase hex (the column's `^[0-9a-f]{64}$` format). */
export function hashApiSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * A new key. `plaintext` is shown to the user once and never stored or logged; only `prefix` and
 * `hash` are kept. The hash covers the secret alone, so the prefix stays a pure lookup handle.
 */
export function mintApiKey(env: KeyEnv): { plaintext: string; prefix: string; hash: string } {
  const prefix = randomPrefix();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { plaintext: `pf_${env}_${prefix}_${secret}`, prefix, hash: hashApiSecret(secret) };
}

/** True when the header looks like it carries one of our keys. A cheap check for the gate, which does no lookup. */
export function isApiKeyHeader(header: string | null | undefined): boolean {
  if (typeof header !== "string" || header.length > MAX_HEADER_LENGTH) return false;
  return (
    header.slice(0, SCHEME.length).toLowerCase() === SCHEME &&
    /^pf_(?:live|test)_/.test(header.slice(SCHEME.length))
  );
}

/**
 * The prefix and secret of an `Authorization: Bearer pf_…` header, or null for anything malformed:
 * wrong scheme, wrong env, wrong lengths, characters outside the alphabets, extra whitespace. Never
 * throws, whatever it is given.
 */
export function parseApiKey(
  header: string | null | undefined,
): { prefix: string; secret: string } | null {
  if (typeof header !== "string" || header.length > MAX_HEADER_LENGTH) return null;
  if (header.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;
  const match = KEY_PATTERN.exec(header.slice(SCHEME.length));
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

/** Does the secret hash to the stored digest? Compared in constant time; a malformed digest is simply false. */
export function secretMatches(secret: string, hash: string): boolean {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashApiSecret(secret), "hex"), Buffer.from(hash, "hex"));
}
