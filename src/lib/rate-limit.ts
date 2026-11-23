/**
 * HTTP request rate limit (PF-084): a fixed-window counter per principal and route class, kept in
 * Postgres so it holds across Vercel instances (ADR-035 proved the pattern for AI runs). The window
 * arithmetic is pure and separate from the database so it is unit-tested without either.
 */
import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { adminDb } from "@/src/db/client";
import { rateLimitHits } from "@/src/db/schema";

import { AppError } from "./errors";
import { logger, safeErrorMessage } from "./logger";

export type Bucket = "upload" | "export" | "generate" | "write" | "read";

type Env = Record<string, string | undefined>;

/** Window length in seconds. */
export const WINDOW_SECONDS = 60;

/** Requests per window per principal when the env doesn't say. */
export const DEFAULT_LIMITS: Record<Bucket, number> = {
  upload: 10,
  export: 20,
  generate: 12,
  write: 60,
  read: 240,
};

const ENV_NAMES: Record<Bucket, string> = {
  upload: "RATE_LIMIT_UPLOAD_PER_MIN",
  export: "RATE_LIMIT_EXPORT_PER_MIN",
  generate: "RATE_LIMIT_GENERATE_PER_MIN",
  write: "RATE_LIMIT_WRITE_PER_MIN",
  read: "RATE_LIMIT_READ_PER_MIN",
};

const BUCKETS = Object.keys(DEFAULT_LIMITS) as Bucket[];

/** Plain decimal digits that make a positive safe integer, else the fallback (a typo must not disable a limit). */
const positiveInt = (value: string | undefined, fallback: number) => {
  // Trim first: a stray space or newline in a .env file must not quietly turn a limit back into the default.
  const text = value?.trim();
  if (!text || !/^\d+$/.test(text)) return fallback;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

export function limitFor(bucket: Bucket, env: Env = process.env): number {
  return positiveInt(env[ENV_NAMES[bucket]], DEFAULT_LIMITS[bucket]);
}

/** The limits at the env present at import. `checkRateLimit` calls `limitFor` itself, so it reads the env per call. */
export const LIMITS = Object.fromEntries(
  BUCKETS.map((bucket) => [bucket, limitFor(bucket)]),
) as Record<Bucket, number>;

/**
 * Who a request is metered as: `key:<id>` for an API key and `user:<id>` for a cookie session. A key
 * is deliberately NOT its owner: a runaway script must not use up the human's allowance (ADR-037).
 * The same string keys the live-view cap, so a key's streams don't take the owner's slots either.
 */
export function principalOf(ctx: { session: { userId: string }; apiKeyId?: string }): string {
  return ctx.apiKeyId ? `key:${ctx.apiKeyId}` : `user:${ctx.session.userId}`;
}

/** The start of the window containing `now`: epoch time floored to a multiple of the window. */
export function windowStart(now: Date, seconds = WINDOW_SECONDS): Date {
  const ms = seconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Longest the counter may delay a request. A hung counter query must not add the pool's 10 s connect
 * timeout to every API request: past this the call fails open (see `checkRateLimit`).
 */
export const COUNTER_TIMEOUT_MS = 2000;

/** What a log line may say about a principal: its kind and a short hash, never the id itself. */
const describePrincipal = (principal: string) =>
  `${principal.split(":")[0]}:${createHash("sha256").update(principal).digest("hex").slice(0, 8)}`;

/** Rejects after `ms`; the query behind it is abandoned, not cancelled. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`counter timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Whole seconds until the window that began at `start` ends; at least 1, so a client always waits. */
export function retryAfterSeconds(now: Date, start: Date, seconds = WINDOW_SECONDS): number {
  const remainingMs = start.getTime() + seconds * 1000 - now.getTime();
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/**
 * Records a hit and throws RATE_LIMITED when the window is already full.
 *
 * Bypasses RLS on purpose: `authenticated` has no grants on `rate_limit_hits`, because a user who
 * could write or delete their own counter row could reset their own limit. Never call this with a
 * principal the caller chose; it comes from the verified session or API key.
 *
 * The increment and the test are ONE statement. A read followed by a write is a real race here, not a
 * theoretical one: on a serverless platform many instances handle one user's requests at once, so two
 * of them can both read 9, both decide 9 is under a limit of 10, and both proceed. The upsert takes a
 * row lock on the counter, so concurrent calls are serialized and each gets its own new count back.
 * A refused request still counts as a hit, which is what keeps a hammering client refused.
 *
 * Fails OPEN (Global Constraint 3): when the counter itself fails (no DATABASE_URL, a pool error, a
 * timeout) the request is let through and the failure is logged at error level, because a broken
 * counter must not take the API down and the data layer shares this database anyway. Only the
 * database call is inside the `try`, so the deliberate RATE_LIMITED below is never swallowed. A caller
 * must therefore NOT wrap this in its own try/catch.
 */
export async function checkRateLimit(
  principal: string,
  bucket: Bucket,
  now: Date = new Date(),
): Promise<void> {
  const start = windowStart(now);
  let hits: number | undefined;
  try {
    const [row] = await withTimeout(
      adminDb()
        .insert(rateLimitHits)
        .values({ principal, bucket, windowStart: start, hits: 1 })
        .onConflictDoUpdate({
          target: [rateLimitHits.principal, rateLimitHits.bucket, rateLimitHits.windowStart],
          set: { hits: sql`${rateLimitHits.hits} + 1` },
        })
        .returning({ hits: rateLimitHits.hits }),
      COUNTER_TIMEOUT_MS,
    );
    hits = row?.hits;
  } catch (err) {
    logger.error("Rate limit counter failed; request not metered", {
      bucket,
      principal: describePrincipal(principal),
      error: safeErrorMessage(err),
    });
    return;
  }
  if (hits === undefined) {
    logger.error("Rate limit counter returned no row; request not metered", {
      bucket,
      principal: describePrincipal(principal),
    });
    return;
  }

  const limit = limitFor(bucket);
  if (hits > limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Wait a moment and try again.", {
      retryAfterSeconds: retryAfterSeconds(now, start),
      limit,
    });
  }
}
