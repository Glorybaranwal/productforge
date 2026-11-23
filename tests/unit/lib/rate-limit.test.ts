import { describe, expect, it } from "vitest";

import { AppError, errorResponse } from "@/src/lib/errors";
import {
  DEFAULT_LIMITS,
  LIMITS,
  limitFor,
  retryAfterSeconds,
  windowStart,
} from "@/src/lib/rate-limit";

describe("windowStart", () => {
  it("floors to the start of the minute", () => {
    expect(windowStart(new Date("2026-11-23T10:15:42.789Z")).toISOString()).toBe(
      "2026-11-23T10:15:00.000Z",
    );
  });

  it("puts the last millisecond of a minute and the first of the next in different windows", () => {
    const last = windowStart(new Date("2026-11-23T10:15:59.999Z"));
    const first = windowStart(new Date("2026-11-23T10:16:00.000Z"));
    expect(last.toISOString()).toBe("2026-11-23T10:15:00.000Z");
    expect(first.toISOString()).toBe("2026-11-23T10:16:00.000Z");
  });

  it("honours a different window length", () => {
    expect(windowStart(new Date("2026-11-23T10:15:42Z"), 300).toISOString()).toBe(
      "2026-11-23T10:15:00.000Z",
    );
  });
});

describe("retryAfterSeconds", () => {
  const start = new Date("2026-11-23T10:15:00.000Z");

  it("is the whole window at its start", () => {
    expect(retryAfterSeconds(start, start)).toBe(60);
  });

  it("rounds a part second up, and is never below 1 at the end of the window", () => {
    expect(retryAfterSeconds(new Date("2026-11-23T10:15:30.500Z"), start)).toBe(30);
    expect(retryAfterSeconds(new Date("2026-11-23T10:15:59.999Z"), start)).toBe(1);
  });
});

describe("limitFor", () => {
  it("uses the defaults when the env is empty", () => {
    expect(limitFor("upload", {})).toBe(10);
    expect(limitFor("export", {})).toBe(20);
    expect(limitFor("generate", {})).toBe(12);
    expect(limitFor("write", {})).toBe(60);
    expect(limitFor("read", {})).toBe(240);
    expect(DEFAULT_LIMITS.read).toBe(240);
  });

  it("reads an override for its own bucket only", () => {
    const env = { RATE_LIMIT_UPLOAD_PER_MIN: "3" };
    expect(limitFor("upload", env)).toBe(3);
    expect(limitFor("read", env)).toBe(240);
  });

  it.each(["abc", "0", "-5", "2.5", ""])("falls back to the default for the bad value %j", (v) => {
    expect(limitFor("write", { RATE_LIMIT_WRITE_PER_MIN: v })).toBe(60);
  });

  it("exposes every bucket on LIMITS", () => {
    expect(Object.keys(LIMITS).sort()).toEqual(["export", "generate", "read", "upload", "write"]);
  });
});

describe("errorResponse Retry-After", () => {
  it("sets the header from the error's details", async () => {
    const res = errorResponse(new AppError("RATE_LIMITED", "Slow down", { retryAfterSeconds: 17 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect((await res.json()).error.details).toEqual({ retryAfterSeconds: 17 });
  });

  it("defaults to 60 when the details don't say", () => {
    expect(
      errorResponse(new AppError("RATE_LIMITED", "Slow down")).headers.get("Retry-After"),
    ).toBe("60");
    expect(
      errorResponse(new AppError("RATE_LIMITED", "Slow down", { limit: 5 })).headers.get(
        "Retry-After",
      ),
    ).toBe("60");
  });

  it("ignores a nonsense retryAfterSeconds", () => {
    const res = errorResponse(new AppError("RATE_LIMITED", "x", { retryAfterSeconds: -3 }));
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("is absent on every other error", () => {
    expect(errorResponse(new AppError("NOT_FOUND", "nope")).headers.get("Retry-After")).toBeNull();
    expect(errorResponse(new Error("boom")).headers.get("Retry-After")).toBeNull();
  });
});
