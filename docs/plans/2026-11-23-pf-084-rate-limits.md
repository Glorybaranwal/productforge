# PF-084 — HTTP rate limits and `Retry-After`

**Spec:** the PF-084 entry in `docs/BACKLOG.md`, ADR-035 (the existing AI budget) and the two ADR-036
follow-ups (how a request's principal and surface are established). Those are the authority.

**Branch:** `m0-rate-limit`, cut from `m0-api-keys`. **Module:** M0 Platform / Rate limit & budgets.

## Context

Three things are metered today: AI runs (12/min/user and 2M tokens/month/workspace, counted from
`agent_runs`, so it holds across Vercel instances — ADR-035), Supabase's own sign-in limit, and open
live-view streams (5 per user, in memory, so per-instance). The other 42 routes have no limit at all,
and **no 429 anywhere sets a `Retry-After` header**, so a well-behaved client cannot back off.

PF-083 just made this matter more: a workspace API key can now drive the API from a script.

## Global Constraints

1. **Counters are written through `adminDb()`, and `authenticated` gets no grants on the table at all.**
   If the acting user could write or delete their own counter rows under RLS, they could reset their own
   limit. There are therefore no RLS policies on this table — there is nothing for them to have. Follow
   `0003_harden_grants.sql` for the revokes, and `findByPrefix` in `src/modules/api-keys/pg-repository.ts`
   for the admin-client pattern and the comment style explaining why it bypasses RLS.
2. **Only `/api/*` is metered. A `page` surface is never metered.** Page renders are cookie-authenticated
   humans in browsers, and ADR-023 fought hard for 86–226 ms page loads; adding a counter round trip to
   every render would undo that. API requests are the abuse surface, and they already pay a lookup, so
   one more is proportionally small.
3. **A failure to record a hit must never fail the request.** Log and continue, exactly as
   `touchLastUsed` does in `src/modules/api-keys/service.ts`. A broken counter must not take the API down.
4. Every `RATE_LIMITED` response carries `Retry-After`, including the existing AI budget's 429.
5. No new dependency. No Redis, no Upstash — Postgres already proved the pattern in ADR-035.
6. `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass. They cannot run here — see Verification.

## Verification

Claude's VM is Linux arm64 and `node_modules` holds darwin-arm64 esbuild binaries, so **vitest, tsx and
`drizzle-kit generate` cannot start**. `node node_modules/typescript/bin/tsc --noEmit` and
`node node_modules/eslint/bin/eslint.js <files>` are pure JavaScript and do run. Run both, report exit
codes, and say plainly that the suite is unexecuted. A plain-node script against the compiled code and
PGlite is the only real evidence available; earlier tasks on this branch used that to good effect.

---

## Task 1 — the counter, and `Retry-After`

**Files:** `src/db/schema/rate-limits.ts` (new, exported from `src/db/schema/index.ts`),
`src/db/migrations/0011_rate_limits.sql` plus its entry in `src/db/migrations/meta/_journal.json`,
`src/db/migrations/meta/0011_snapshot.json`, `src/lib/rate-limit.ts`, `src/lib/errors.ts`,
`tests/unit/lib/rate-limit.test.ts`, `tests/integration/db/rate-limit-data.test.ts`.

**The table.** `rate_limit_hits`: `principal` text not null (see below), `bucket` text not null (the
route class), `window_start` timestamptz not null, `hits` integer not null default 0. Primary key
`(principal, bucket, window_start)`. One index on `window_start` so old rows can be swept.

- `principal` is `user:<uuid>` for a cookie session and `key:<uuid>` for an API key. Prefixing keeps the
  two from colliding and makes a log line legible. A key's hits are **its own**, not its owner's: a
  runaway script must not lock the human out of the dashboard.
- Grants: `REVOKE ALL ON TABLE "public"."rate_limit_hits" FROM "authenticated", "anon";` — and enable RLS
  with no policies, so that even a future accidental grant denies by default.
- `pnpm db:generate` cannot run here, so hand-write the SQL **and** `0011_snapshot.json` from
  `0010_snapshot.json`, and append the journal entry (`idx` 11, `tag` `0011_rate_limits`). Without the
  journal entry `db:migrate` silently skips the file. Note in your report that it is hand-written.

**`src/lib/rate-limit.ts`.** Keep the arithmetic pure and separately testable from the database:

```ts
export type Bucket = "upload" | "export" | "generate" | "write" | "read";
export const LIMITS: Record<Bucket, number>;        // from env, with the defaults below
export function windowStart(now: Date, seconds?: number): Date;   // floor to the window
export function retryAfterSeconds(now: Date, start: Date, seconds?: number): number;
export function limitFor(bucket: Bucket, env?: Env): number;
/** Records a hit and throws RATE_LIMITED when the window is already full. */
export async function checkRateLimit(principal: string, bucket: Bucket, now?: Date): Promise<void>;
```

Defaults, each overridable by env (`RATE_LIMIT_UPLOAD_PER_MIN` and so on): upload 10, export 20,
generate 12, write 60, read 240, all per minute per principal.

`checkRateLimit` must **increment and test in one statement**, so two concurrent requests cannot both
read 9 and both proceed. An upsert returning the new count is the way:
`insert … on conflict (principal, bucket, window_start) do update set hits = rate_limit_hits.hits + 1
returning hits`. Throw when the returned count exceeds the limit. Put the reasoning in a comment —
a read-then-write here is a real race, not a theoretical one.

The thrown `AppError` carries `details: { retryAfterSeconds }` so the header can be set from it.

**`Retry-After`.** `errorResponse` in `src/lib/errors.ts` currently returns `Response.json(body, { status })`
with no headers. Add the header whenever the error is `RATE_LIMITED`: take `retryAfterSeconds` from the
error's details when present, else default to 60. Keep `toErrorBody` unchanged — it is used elsewhere
(`src/lib/supabase/proxy.ts` builds bodies directly), so the header belongs in `errorResponse` alone.
Check the existing AI budget error in `src/ai/orchestrator/budget.ts`: it already puts
`retryAfterSeconds: 60` in its details, so it should start carrying the header with no change of its own —
confirm that and say so.

**Tests.** Unit: window flooring across a minute boundary, `retryAfterSeconds` at the start and end of a
window, env overrides, and a bad env value falling back to the default. Integration (PGlite): a hit
recorded, the limit refused on the (n+1)th call, the window resetting, and — the one that matters —
**two separate contexts sharing one counter**, which is what proves this works across Vercel instances.

**Done when:** the migration applies on PGlite, the counter refuses the (n+1)th call in a window and
allows the first of the next, two contexts share a counter, and a `RATE_LIMITED` response carries
`Retry-After`.

---

## Task 2 — classify every request, and apply the limit

**Files:** `src/lib/auth-gate.ts` (the classifier, beside `requestSurface`), `proxy.ts` and
`src/lib/supabase/proxy.ts` (stamp the class), `src/lib/request-key.ts` (read it),
`src/modules/workspaces/service.ts` (apply it in `currentContext`),
`app/api/projects/[id]/runs/live/route.ts` (key the stream cap by principal),
`tests/unit/lib/auth-gate.test.ts`, `tests/integration/api/rate-limit.test.ts`, and the route matrix.

**Classify by path and method**, next to `requestSurface` so the two stay together:

```ts
export function rateBucket(pathname: string, method: string): Bucket | null;   // null = don't meter
```

- `null` for anything that is not under `/api` (Constraint 2).
- `upload` for `POST /api/projects/:id/sources` — it parses up to 10 MB of PDF.
- `export` for the three export paths (`prds/:id/markdown`, `projects/:id/backlog/markdown`,
  `projects/:id/traceability/csv`) and `POST /api/projects/:id/exports/jira`.
- `generate` for the generation endpoints (`discovery`, `prd/generate`, `backlog/generate`,
  `sprints/plan`, `changes/:id/analyze`, `stories/:id/regenerate`). This sits **on top of** the AI run
  budget, which stays exactly as it is — say in your report how you enumerated these rather than listing
  them by hand from memory.
- `write` for every other non-safe method; `read` for the rest.

**Stamp it in the proxy**, alongside the surface header, in the same place and the same way — the proxy
overwrites whatever the client sent, which is what makes the surface header trustworthy (ADR-036
follow-up). Add the new header name beside `SURFACE_HEADER`.

**Apply it in `currentContext`**, once the principal is known, for `/api/*` only:

- API key → `key:<key id>`; cookie session → `user:<user id>`.
- Keep the existing lazy imports. `src/lib/request-key.ts` reaches `next/headers` and is imported lazily
  on purpose, so that `pnpm db:seed` does not pull it in (a PF-064 fix). Anything you add that touches
  `next/headers` must be imported the same way, and the import graph of `scripts/db-seed.ts` must still
  not reach `src/lib/supabase/server.ts`. Check that before you finish.
- The check runs after the key is verified, so a request with a bad key costs no counter write.

**The sign-in guard.** `/login` and `/auth/*` have no principal yet, so meter them per IP in
`src/lib/supabase/proxy.ts`: 20 per minute, in memory. Middleware must do no database work, so this one
is per-instance and therefore approximate — say so in a comment. It is a speed bump in front of
Supabase's own sign-in limit, not the real control. Read the client IP the way the platform provides it
and fall back to metering nothing rather than to a shared bucket, so one missing header cannot lock out
every visitor.

**The live-stream cap.** `MAX_STREAMS_PER_USER` in the live route counts concurrent open streams in a
`Map` keyed by `ctx.session.userId`. A concurrency cap is not a rate limit, so **do not** move it onto
the counters — that would silently change what it means. Instead key that map by the same principal
string, so a key's streams no longer consume the human's five slots. Leave its in-memory,
per-instance nature alone and note it.

**Tests.** `rateBucket` unit-tested per class, including that a non-`/api` path is never metered.
Integration: the 11th upload inside a minute gets 429 **with a `Retry-After` header**; the AI budget's
429 now carries the header too; a read key and its owner do not share a counter; a page render is not
metered. Extend the route matrix if a cheap assertion fits, but do not make its sweeps depend on counter
state — a shared counter across a 35-route sweep would make the sweep order-dependent, which is a trap
this file has already been caught by.

**Done when:** every test above is written, `tsc` and `eslint` are clean, the 11th upload in a minute is
refused with `Retry-After`, a key and its owner meter separately, and page renders are not metered.
