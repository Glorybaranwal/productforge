import { describe, expect, it } from "vitest";

import { DrizzleQueryError } from "drizzle-orm/errors";

import { MAX_LOGGED_STRING, redact, safeErrorMessage } from "@/src/lib/logger";

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

  it("masks a ProductForge API key wherever it appears (PF-083)", () => {
    const key = "pf_live_abcdefgh_" + "Zx9_-".repeat(8) + "Zx9";
    const out = redact({
      note: `sent ${key} to the server`,
      header: `Bearer ${key}`,
      ok: "pf_live",
    });
    expect(JSON.stringify(out)).not.toContain("Zx9_-Zx9_-");
    expect(out).toEqual({
      note: "sent [redacted] to the server",
      header: "[redacted]",
      ok: "pf_live",
    });
    expect(redact({ text: "pf_test_abcdefgh_" + "A".repeat(43) })).toEqual({ text: "[redacted]" });
    // Under a key name too, even for a value the patterns would not recognise.
    expect(redact({ plaintext: "anything", secret_hash: "abc" })).toEqual({
      plaintext: "[redacted]",
      secret_hash: "[redacted]",
    });
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

describe("safeErrorMessage", () => {
  const id = "3f2c9a52-7d1e-4c58-9a40-1b6e8d0c7f11";
  const query = (cause?: Error) =>
    new DrizzleQueryError(
      'insert into "rate_limit_hits" ("principal", "bucket") values ($1, $2) on conflict do update',
      [`user:${id}`, "upload"],
      cause,
    );

  it("reports the driver's error, not the SQL and its bound parameters", () => {
    const err = query(new Error("connection terminated unexpectedly"));
    // The premise: drizzle's own message does carry the parameter.
    expect(err.message).toContain(id);
    expect(safeErrorMessage(err)).toBe("connection terminated unexpectedly");
  });

  it("never returns the parameters, with or without a cause", () => {
    expect(safeErrorMessage(query())).toBe("Query failed");
    expect(safeErrorMessage(query(query(new Error("pool exhausted"))))).toBe("pool exhausted");
    expect(safeErrorMessage(query(query()))).toBe("Query failed");
  });

  it("still unwraps when the error was re-wrapped the way demo-seed's step() does", () => {
    const inner = query(new Error("connection terminated unexpectedly"));
    // src/modules/projects/demo-seed.ts: the original's message is interpolated into a new one and
    // the original is kept as `cause`, so "Failed query:" is no longer at the start of the message.
    const wrapped = new Error(`Seed step "discovery" failed: ${inner.message}`, { cause: inner });
    expect(wrapped.message).toContain(id);
    expect(wrapped.message.startsWith("Failed query:")).toBe(false);
    const safe = safeErrorMessage(wrapped);
    expect(safe).toBe("connection terminated unexpectedly");
    expect(safe).not.toContain(id);
    expect(safe).not.toContain("params:");
    const logged = JSON.stringify(redact({ error: wrapped }));
    expect(logged).not.toContain(id);
    expect(logged).not.toContain("params:");
  });

  it("returns nothing of a re-wrapper that lost its cause", () => {
    const wrapped = new Error(`Seed step "discovery" failed: ${query().message}`);
    expect(safeErrorMessage(wrapped)).toBe("Query failed");
  });

  it("passes an ordinary error's message through", () => {
    expect(safeErrorMessage(new Error("DATABASE_URL isn't set"))).toBe("DATABASE_URL isn't set");
    expect(safeErrorMessage("boom")).toBe("boom");
    expect(safeErrorMessage({ id })).toBe("Unknown error");
  });

  it("is what redact() uses for an Error in a log field", () => {
    const out = JSON.stringify(redact({ err: query(new Error("timeout")) }));
    expect(out).toContain("timeout");
    expect(out).not.toContain(id);
  });
});
