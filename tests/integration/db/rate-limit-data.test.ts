/**
 * The HTTP rate-limit counter in Postgres (PF-084): `rate_limit_hits` and `checkRateLimit`, on PGlite
 * with the real migrations. `adminDb()` is pointed at the PGlite database (the table owner there).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/src/db/schema";
import { rateLimitHits } from "@/src/db/schema";
import { AppError } from "@/src/lib/errors";
import { logger } from "@/src/lib/logger";
import { checkRateLimit, COUNTER_TIMEOUT_MS } from "@/src/lib/rate-limit";

import { createRlsDb, expectPgCode, type RlsHarness, USERS } from "./rls-harness";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/db/client")>()),
  adminDb: () => holder.db,
}));

let h: RlsHarness;
const T0 = new Date("2026-11-23T10:15:10.000Z");
const user = `user:${USERS.ana}`;

beforeAll(async () => {
  h = await createRlsDb();
});
afterAll(async () => {
  await h.pg.close();
});
beforeEach(async () => {
  holder.db = h.db;
  await h.db.delete(rateLimitHits);
});

/** Runs `n` calls and returns how many were allowed and how many refused. */
async function burst(principal: string, bucket: "upload" | "read", n: number, at = T0) {
  let allowed = 0;
  let refused: AppError | undefined;
  for (let i = 0; i < n; i += 1) {
    try {
      await checkRateLimit(principal, bucket, at);
      allowed += 1;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      refused = err;
    }
  }
  return { allowed, refused };
}

describe("checkRateLimit", () => {
  it("records a hit", async () => {
    await checkRateLimit(user, "upload", T0);
    const rows = await h.db.select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ principal: user, bucket: "upload", hits: 1 });
    expect(rows[0]?.windowStart.toISOString()).toBe("2026-11-23T10:15:00.000Z");
  });

  it("allows the limit and refuses the next call, with how long to wait", async () => {
    // upload's default is 10 per minute
    const { allowed, refused } = await burst(user, "upload", 11);
    expect(allowed).toBe(10);
    expect(refused?.code).toBe("RATE_LIMITED");
    expect(refused?.details).toMatchObject({ retryAfterSeconds: 50, limit: 10 });
  });

  it("allows the first call of the next window", async () => {
    await burst(user, "upload", 11);
    await expect(
      checkRateLimit(user, "upload", new Date("2026-11-23T10:16:00.000Z")),
    ).resolves.toBeUndefined();
  });

  it("keeps principals and buckets apart", async () => {
    await burst(user, "upload", 11);
    await expect(checkRateLimit(`key:${USERS.ana}`, "upload", T0)).resolves.toBeUndefined();
    await expect(checkRateLimit(user, "read", T0)).resolves.toBeUndefined();
  });

  it("honours an env override", async () => {
    vi.stubEnv("RATE_LIMIT_UPLOAD_PER_MIN", "2");
    try {
      const { allowed } = await burst(user, "upload", 5);
      expect(allowed).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is atomic: concurrent calls can't all slip under the limit", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => checkRateLimit(user, "upload", T0)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const [row] = await h.db.select().from(rateLimitHits);
    expect(row?.hits).toBe(25);
  });

  it("shares one counter between separate contexts (separate instances)", async () => {
    // A second drizzle client over the same database, as a second Vercel instance would have.
    const other = drizzle({ client: h.pg as PGlite, schema });
    for (let i = 0; i < 10; i += 1) {
      holder.db = i % 2 === 0 ? h.db : other;
      await checkRateLimit(user, "upload", T0);
    }
    holder.db = other;
    await expect(checkRateLimit(user, "upload", T0)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    holder.db = h.db;
    await expect(checkRateLimit(user, "upload", T0)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    // One row, whose count is the total across both contexts, read through the other client.
    const rows = await other.select().from(rateLimitHits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hits).toBe(12);
  });
});

describe("checkRateLimit when the counter fails (fails open)", () => {
  const broken = (err: unknown) => ({
    insert: () => {
      throw err;
    },
  });
  const hanging = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({ returning: () => new Promise<never>(() => {}) }),
      }),
    }),
  };
  const noRow = {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [] }) }),
    }),
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lets the request through and logs when the database call throws", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    holder.db = broken(new Error("DATABASE_URL isn't set"));
    await expect(checkRateLimit(user, "upload", T0)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    const [message, meta] = log.mock.calls[0] ?? [];
    expect(message).toMatch(/not metered/);
    // The raw principal (it holds a user id) is never logged.
    expect(JSON.stringify(meta)).not.toContain(USERS.ana);
    expect(meta).toMatchObject({ bucket: "upload" });
  });

  it("does not log the principal when the failure is a drizzle query error", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    // What drizzle really throws: a message holding the SQL and every bound parameter.
    const wrapped = new DrizzleQueryError(
      'insert into "rate_limit_hits" ("principal", "bucket", "window_start", "hits") values ($1, $2, $3, $4)',
      [user, "upload", T0.toISOString(), 1],
      new Error("connection terminated unexpectedly"),
    );
    expect(wrapped.message).toContain(USERS.ana);
    holder.db = broken(wrapped);
    await expect(checkRateLimit(user, "upload", T0)).resolves.toBeUndefined();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("connection terminated unexpectedly");
    expect(logged).not.toContain(USERS.ana);
    expect(logged).not.toContain("params:");
  });

  it("lets the request through when the counter hangs past the timeout", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    holder.db = hanging;
    const call = checkRateLimit(user, "upload", T0);
    await vi.advanceTimersByTimeAsync(COUNTER_TIMEOUT_MS);
    await expect(call).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
  });

  it("lets the request through and logs when no row comes back", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    holder.db = noRow;
    await expect(checkRateLimit(user, "upload", T0)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
  });

  it("still refuses with RATE_LIMITED when the counter works and the window is full", async () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { refused } = await burst(user, "upload", 11);
    expect(refused?.code).toBe("RATE_LIMITED");
    expect(log).not.toHaveBeenCalled();
  });
});

describe("rate_limit_hits grants", () => {
  it("refuses authenticated and anon every operation", async () => {
    await checkRateLimit(user, "read", T0);
    await expectPgCode(
      h.as(USERS.ana, (tx) => tx.select().from(rateLimitHits)),
      "42501",
    );
    await expectPgCode(
      h.as(USERS.ana, (tx) =>
        tx.insert(rateLimitHits).values({ principal: user, bucket: "read", windowStart: T0 }),
      ),
      "42501",
    );
    await expectPgCode(
      h.as(USERS.ana, (tx) => tx.delete(rateLimitHits)),
      "42501",
    );
    await expectPgCode(
      h.asAnon((tx) => tx.select().from(rateLimitHits)),
      "42501",
    );
  });
});
