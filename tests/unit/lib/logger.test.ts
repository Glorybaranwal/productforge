import { describe, expect, it } from "vitest";

import { MAX_LOGGED_STRING, redact } from "@/src/lib/logger";

describe("redact (ADR-035)", () => {
  it("masks values under secret-looking keys, at any depth", () => {
    expect(
      redact({
        apiKey: "abc",
        nested: { password: "p", Authorization: "x", ok: 1 },
        cookie: "c",
        service_role: "s",
      }),
    ).toEqual({
      apiKey: "[redacted]",
      nested: { password: "[redacted]", Authorization: "[redacted]", ok: 1 },
      cookie: "[redacted]",
      service_role: "[redacted]",
    });
  });

  it("masks credential-shaped strings under any key", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
    const out = redact({
      note: `key sk-proj-ABCDEFGHIJKLMNOPQRST and ${jwt} and Bearer abcdefghijklmnopqrstuv`,
    });
    expect(out).toEqual({ note: "key [redacted] and [redacted] and [redacted]" });
  });

  it("cuts long text such as a pasted document", () => {
    const text = "x".repeat(MAX_LOGGED_STRING + 50);
    expect(redact(text)).toBe(`${"x".repeat(MAX_LOGGED_STRING)}…[+50 chars]`);
  });

  it("reduces errors to name and message, and stops at depth 4", () => {
    expect(redact(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
    expect(redact({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
      a: { b: { c: { d: "[nested]" } } },
    });
  });

  it("leaves ordinary ids, numbers and short messages alone", () => {
    const meta = {
      runId: "0f6b1c1e-1111-4222-8333-944455556666",
      attempts: 2,
      ok: true,
      none: null,
    };
    expect(redact(meta)).toEqual(meta);
  });
});
