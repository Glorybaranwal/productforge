/**
 * HTTP request rate limit (PF-084): a fixed-window counter per principal and route class, kept in
 * Postgres so it holds across Vercel instances (ADR-035 proved the pattern for AI runs). The window
 * arithmetic is pure and separate from the database so it is unit-tested without either.
 */
import { sql } from "drizzle-orm";

import { adminDb } from "@/src/db/client";
import { rateLimitHits } from "@/src/db/schema";

import { AppError } from "./errors";

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

/** A positive whole number, else the fallback (a typo in the env must not disable a limit). */
const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : fallback;
};

export function limitFor(bucket: Bucket, env: Env = process.env): number {
  return positiveInt(env[ENV_NAMES[bucket]], DEFAULT_LIMITS[bucket]);
}

/** The limits at the env present at import. `checkRateLimit` calls `limitFor` itself, so it reads the env per call. */
export const LIMITS = Object.fromEntries(
  BUCKETS.map((bucket) => [bucket, limitFor(bucket)]),
) as Record<Bucket, number>;

/** The start of the window containing `now`: epoch time floored to a multiple of the window. */
export function windowStart(now: Date, seconds = WINDOW_SECONDS): Date {
  const ms = seconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
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
 */
export async function checkRateLimit(
  principal: string,
  bucket: Bucket,
  now: Date = new Date(),
): Promise<void> {
  const start = windowStart(now);
  const [row] = await adminDb()
    .insert(rateLimitHits)
    .values({ principal, bucket, windowStart: start, hits: 1 })
    .onConflictDoUpdate({
      target: [rateLimitHits.principal, rateLimitHits.bucket, rateLimitHits.windowStart],
      set: { hits: sql`${rateLimitHits.hits} + 1` },
    })
    .returning({ hits: rateLimitHits.hits });

  const limit = limitFor(bucket);
  if (row && row.hits > limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Wait a moment and try again.", {
      retryAfterSeconds: retryAfterSeconds(now, start),
      limit,
    });
  }
}
