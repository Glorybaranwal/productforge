import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/src/lib/logger";

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
    // 45 s windows from the epoch: 10:15:00 is 37_800 s in, so 10:15:50 is in the window starting at
    // 10:15:45, whereas a 60 s window would floor it to 10:15:00. An implementation that ignored
    // `seconds` would fail this.
    expect(windowStart(new Date("2026-11-23T10:15:50Z"), 45).toISOString()).not.toBe(
      windowStart(new Date("2026-11-23T10:15:50Z")).toISOString(),
    );
    const start = windowStart(new Date("2026-11-23T10:15:50Z"), 45);
    expect(start.getTime() % 45_000).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(new Date("2026-11-23T10:15:50Z").getTime());
  });
});

describe("retryAfterSeconds", () => {
  const start = new Date("2026-11-23T10:15:00.000Z");

  it("is the whole window at its start", () => {
    expect(retryAfterSeconds(start, start)).toBe(60);
  });

  it("honours a different window length", () => {
    expect(retryAfterSeconds(start, start, 45)).toBe(45);
    expect(retryAfterSeconds(new Date("2026-11-23T10:15:40.000Z"), start, 45)).toBe(5);
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

  it.each(["abc", "0", "-5", "2.5", "", "1e21", "0x10", " 5", "9007199254740993"])(
    "falls back to the default for the bad value %j",
    (v) => {
      expect(limitFor("write", { RATE_LIMIT_WRITE_PER_MIN: v })).toBe(60);
    },
  );

  it("exposes every bucket on LIMITS", () => {
    expect(Object.keys(LIMITS).sort()).toEqual(["export", "generate", "read", "upload", "write"]);
  });
});

describe("errorResponse Retry-After", () => {
  afterEach(() => vi.restoreAllMocks());

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

  it("ignores a nonsense retryAfterSeconds, and says so", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = errorResponse(new AppError("RATE_LIMITED", "x", { retryAfterSeconds: -3 }));
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is absent on every other error", () => {
    expect(errorResponse(new AppError("NOT_FOUND", "nope")).headers.get("Retry-After")).toBeNull();
    expect(errorResponse(new Error("boom")).headers.get("Retry-After")).toBeNull();
  });
});
