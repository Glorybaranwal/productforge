/**
 * Database access for the Supabase phase (ADR-005, ADR-020). Server only.
 *
 * - `withUser(session, fn)` runs `fn` in one transaction as the signed-in user: role `authenticated`
 *   and their JWT claims, so every RLS policy applies. Route handlers and services use this.
 * - `adminDb()` connects as the table owner and bypasses RLS: migrations, seed and system jobs only,
 *   never on behalf of a request.
 *
 * Runtime traffic goes through Supabase's transaction pooler (`DATABASE_URL`, port 6543), which
 * doesn't support prepared statements; the role and claims are set with `set_config(…, true)`, so
 * they end with the transaction and never leak to the next user of the connection.
 */
import { sql, type SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema";
import { sslFor } from "./ssl.mjs";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Who the database should act as: a Supabase Auth user. */
export const DbSession = z.object({ userId: z.uuid(), email: z.string().nullish() });
export type DbSession = z.infer<typeof DbSession>;

type Shared = { db?: Db; url?: string; close?: () => Promise<void> };
// One pool per server process (and per `next dev` reload).
const shared: Shared = ((globalThis as { __productforgePg?: Shared }).__productforgePg ??= {});

export function adminDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL isn't set — see .env.example");
  // `next dev` reloads .env.local without restarting; a pool opened with the old URL or password
  // would keep failing, so a changed URL gets a fresh pool and the old one is closed.
  if (shared.db && shared.url !== url) {
    void shared.close?.();
    shared.db = undefined;
  }
  if (!shared.db) {
    const client = postgres(url, {
      prepare: false,
      // Encrypted on the wire; Supabase refuses plain connections (ADR-023).
      ssl: sslFor(url),
      // A page reads in parallel; Supabase's pooler multiplexes these onto its own pool.
      max: 10,
      // Keep connections open between clicks: a new one costs several round trips (TCP, TLS,
      // auth) (ADR-023).
      idle_timeout: 240,
      connect_timeout: 10,
    });
    shared.db = drizzle({ client, schema });
    shared.url = url;
    shared.close = () => client.end({ timeout: 5 });
  }
  return shared.db;
}

/**
 * The statement that makes a transaction act as `session`: role `authenticated` plus the JWT claims
 * that `auth.uid()` reads, all with `is_local = true` so they end with the transaction. One
 * statement, so acting as a user costs a single round trip. Exported so the RLS tests run exactly
 * what production runs.
 */
export function actAs(session: DbSession): SQL {
  const { userId, email } = DbSession.parse(session);
  const claims = JSON.stringify({ sub: userId, role: "authenticated", email: email ?? null });
  return sql`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
}

export async function withUser<T>(session: DbSession, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return adminDb().transaction(async (tx) => {
    await tx.execute(actAs(session));
    return fn(tx);
  });
}
