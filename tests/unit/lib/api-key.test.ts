import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrap timingSafeEqual so a test can see that the comparison goes through it.
const crypto = vi.hoisted(() => ({ spy: undefined as undefined | ((...a: unknown[]) => void) }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (...args: Parameters<typeof real.timingSafeEqual>) => {
      crypto.spy?.(...args);
      return real.timingSafeEqual(...args);
    },
  };
});

import {
  hashApiSecret,
  isApiKeyHeader,
  KEY_PREFIX_LENGTH,
  mintApiKey,
  parseApiKey,
  secretMatches,
} from "@/src/lib/api-key";

const bearer = (plaintext: string) => `Bearer ${plaintext}`;
const SECRET = "A".repeat(43);
const KEY = `pf_live_abcdefgh_${SECRET}`;

beforeEach(() => {
  crypto.spy = undefined;
});

describe("mintApiKey (PF-083)", () => {
  it("makes pf_<env>_<prefix>_<secret> with an 8-char base32 prefix and a 32-byte base64url secret", () => {
    for (const env of ["live", "test"] as const) {
      const { plaintext, prefix } = mintApiKey(env);
      expect(prefix).toHaveLength(KEY_PREFIX_LENGTH);
      expect(prefix).toMatch(/^[a-z2-7]{8}$/);
      expect(plaintext).toMatch(new RegExp(`^pf_${env}_${prefix}_[A-Za-z0-9_-]{43}$`));
      expect(Buffer.from(plaintext.split("_").slice(3).join("_"), "base64url")).toHaveLength(32);
    }
  });

  it("returns the SHA-256 of the secret alone, as 64 hex characters", () => {
    const { plaintext, prefix, hash } = mintApiKey("test");
    const secret = plaintext.slice(`pf_test_${prefix}_`.length);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(hash).not.toBe(createHash("sha256").update(plaintext).digest("hex"));
  });

  it("never repeats a key or a prefix across many mints, and uses the whole alphabet", () => {
    const keys = Array.from({ length: 500 }, () => mintApiKey("test"));
    expect(new Set(keys.map((k) => k.plaintext)).size).toBe(500);
    expect(new Set(keys.map((k) => k.prefix)).size).toBe(500);
    expect(new Set(keys.flatMap((k) => [...k.prefix])).size).toBe(32);
  });
});

describe("parseApiKey", () => {
  it("round-trips a minted key", () => {
    const { plaintext, prefix, hash } = mintApiKey("live");
    const parsed = parseApiKey(bearer(plaintext));
    expect(parsed?.prefix).toBe(prefix);
    expect(secretMatches(parsed!.secret, hash)).toBe(true);
  });

  it("takes the scheme in any case", () => {
    expect(parseApiKey(`bearer ${KEY}`)).toEqual({ prefix: "abcdefgh", secret: SECRET });
    expect(parseApiKey(`BEARER ${KEY}`)).toEqual({ prefix: "abcdefgh", secret: SECRET });
  });

  it("keeps an underscore or dash inside the secret (the parts have fixed lengths)", () => {
    const secret = "_".repeat(20) + "-".repeat(23);
    expect(parseApiKey(bearer(`pf_test_abcdefgh_${secret}`))?.secret).toBe(secret);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["scheme only", "Bearer "],
    ["no scheme", KEY],
    ["wrong scheme", `Basic ${KEY}`],
    ["token scheme", `Token ${KEY}`],
    ["unknown env", bearer(`pf_dev_abcdefgh_${SECRET}`)],
    ["no pf_", bearer(`xx_live_abcdefgh_${SECRET}`)],
    ["prefix too short", bearer(`pf_live_abcdefg_${SECRET}`)],
    ["prefix too long", bearer(`pf_live_abcdefghi_${SECRET}`)],
    ["prefix uppercase", bearer(`pf_live_ABCDEFGH_${SECRET}`)],
    ["prefix outside base32 (1, 8, 0, 9)", bearer(`pf_live_abcd1890_${SECRET}`)],
    ["secret too short", bearer(`pf_live_abcdefgh_${"A".repeat(42)}`)],
    ["secret too long", bearer(`pf_live_abcdefgh_${"A".repeat(44)}`)],
    ["secret with padding", bearer(`pf_live_abcdefgh_${"A".repeat(42)}=`)],
    ["secret with a space", bearer(`pf_live_abcdefgh_${"A".repeat(21)} ${"A".repeat(21)}`)],
    ["two spaces after the scheme", `Bearer  ${KEY}`],
    ["trailing space", `${bearer(KEY)} `],
    ["trailing newline", `${bearer(KEY)}\n`],
    ["header injection", `${bearer(KEY)}\r\nX-Evil: 1`],
    ["two keys", `${bearer(KEY)}, ${bearer(KEY)}`],
    ["null byte", bearer(`pf_live_abcdefgh_\u0000${"A".repeat(42)}`)],
    ["non-ASCII", bearer(`pf_live_abcdefgh_${"é".repeat(43)}`)],
    ["a JWT", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"],
    ["a huge header", `Bearer ${"A".repeat(100_000)}`],
  ] as const)("returns null, without throwing, for %s", (_name, header) => {
    expect(parseApiKey(header)).toBeNull();
  });

  it("does not throw on non-string input", () => {
    for (const bad of [42, {}, [], Symbol.iterator, () => 1] as unknown[])
      expect(parseApiKey(bad as string)).toBeNull();
  });
});

describe("isApiKeyHeader (the gate's cheap check)", () => {
  it("is true for anything shaped like our key, even a bad one: the route verifies", () => {
    expect(isApiKeyHeader(bearer(KEY))).toBe(true);
    expect(isApiKeyHeader("Bearer pf_test_x")).toBe(true);
    expect(isApiKeyHeader("bearer pf_live_")).toBe(true);
  });

  it("is false for other credentials, other schemes and junk", () => {
    expect(isApiKeyHeader("Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc")).toBe(false);
    expect(isApiKeyHeader(`Basic ${KEY}`)).toBe(false);
    expect(isApiKeyHeader(KEY)).toBe(false);
    expect(isApiKeyHeader("Bearer pf_dev_abc")).toBe(false);
    expect(isApiKeyHeader("")).toBe(false);
    expect(isApiKeyHeader(null)).toBe(false);
    expect(isApiKeyHeader(undefined)).toBe(false);
    expect(isApiKeyHeader(`Bearer pf_live_${"A".repeat(10_000)}`)).toBe(false);
  });
});

describe("hashApiSecret and secretMatches", () => {
  it("hashes to lowercase hex SHA-256 and is deterministic", () => {
    expect(hashApiSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashApiSecret(SECRET)).toBe(hashApiSecret(SECRET));
    expect(hashApiSecret(SECRET)).not.toBe(hashApiSecret(SECRET.slice(0, -1) + "B"));
  });

  it("accepts the right secret and refuses any other", () => {
    const { plaintext, prefix, hash } = mintApiKey("test");
    const secret = plaintext.slice(`pf_test_${prefix}_`.length);
    expect(secretMatches(secret, hash)).toBe(true);
    expect(secretMatches(secret.slice(0, -1) + (secret.endsWith("A") ? "B" : "A"), hash)).toBe(
      false,
    );
    expect(secretMatches("", hash)).toBe(false);
    expect(secretMatches(plaintext, hash)).toBe(false);
  });

  it("compares with timingSafeEqual, on two 32-byte digests", () => {
    const calls: unknown[][] = [];
    crypto.spy = (...args) => void calls.push(args);
    const { hash } = mintApiKey("test");
    secretMatches("anything", hash);
    expect(calls).toHaveLength(1);
    const [a, b] = calls[0] as [Buffer, Buffer];
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
  });

  it("answers false, and never throws, for a malformed stored hash", () => {
    for (const bad of ["", "abc", "z".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65)])
      expect(secretMatches(SECRET, bad)).toBe(false);
    expect(secretMatches(SECRET, null as unknown as string)).toBe(false);
  });
});
