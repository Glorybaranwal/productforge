/**
 * The HTTP rate-limit counter in Postgres (PF-084): `rate_limit_hits` and `checkRateLimit`, on PGlite
 * with the real migrations. `adminDb()` is pointed at the PGlite database (the table owner there).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/src/db/schema";
import { rateLimitHits } from "@/src/db/schema";
import { AppError } from "@/src/lib/errors";
import { checkRateLimit } from "@/src/lib/rate-limit";

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
