/**
 * Fixed-window request counters (PF-084). One row per `(principal, bucket, window_start)`; `hits` is
 * incremented in place by a single upsert (see `checkRateLimit` in `src/lib/rate-limit.ts`).
 *
 * `principal` is `user:<uuid>` for a cookie session and `key:<uuid>` for an API key, so the two never
 * collide and a key's hits are its own, not its owner's. `bucket` is the route class.
 *
 * RLS is enabled and there are deliberately NO policies, and migration `0011_rate_limits.sql` revokes
 * every privilege from `authenticated` and `anon`: a user who could write or delete their own counter
 * row could reset their own limit. Only `adminDb()` touches this table.
 */
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    principal: text("principal").notNull(),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "rate_limit_hits_pkey", columns: [t.principal, t.bucket, t.windowStart] }),
    // So old windows can be swept by a range delete.
    index("rate_limit_hits_window_start_idx").on(t.windowStart),
  ],
).enableRLS();
