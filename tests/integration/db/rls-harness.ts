/**
 * Shared setup for the RLS tests (PF-012, ADR-020). Runs the real migrations on an in-process
 * Postgres (PGlite) after a stand-in for what Supabase provides — its roles, `auth.users` and
 * `auth.uid()` — and acts as each user with the same statements `withUser` runs in production.
 * Each test file gets its own database.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { actAs } from "@/src/db/client";
import * as schema from "@/src/db/schema";
import { auditLogs, projects, workspaceMembers, workspaces } from "@/src/db/schema";

// What a Supabase database already has before our migrations run. auth.uid() is Supabase's definition.
const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Ana owns a team with Dev (developer), Pam (PM) and Adi (admin); Ben owns another; Newbie and Val have none. */
export const USERS = {
  ana: id(1),
  ben: id(2),
  dev: id(3),
  pam: id(4),
  newbie: id(5),
  adi: id(6),
  val: id(7),
};
export const WS = { ana: id(101), ben: id(102) };
export const PROJECT = { alpha: id(201), bravo: id(202) };

type Db = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type RlsHarness = Awaited<ReturnType<typeof createRlsDb>>;

export async function createRlsDb() {
  const pg = new PGlite();
  const db = drizzle({ client: pg, schema });
  await pg.exec(SUPABASE);
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  // Seed as the table owner (bypasses RLS), like a system job.
  for (const [name, user] of Object.entries(USERS))
    await pg.query("insert into auth.users (id, email) values ($1, $2)", [
      user,
      `${name}@example.com`,
    ]);
  await db.insert(workspaces).values([
    { id: WS.ana, name: "Ana's team", ownerId: USERS.ana },
    { id: WS.ben, name: "Ben's team", ownerId: USERS.ben },
  ]);
  await db.insert(workspaceMembers).values([
    { workspaceId: WS.ana, userId: USERS.ana, role: "owner" },
    { workspaceId: WS.ana, userId: USERS.dev, role: "developer" },
    { workspaceId: WS.ana, userId: USERS.pam, role: "pm" },
    { workspaceId: WS.ana, userId: USERS.adi, role: "admin" },
    { workspaceId: WS.ben, userId: USERS.ben, role: "owner" },
  ]);
  const project = {
    domain: "Fintech",
    audience: "Retail customers",
    teamSize: 5,
    sprintLengthDays: 14,
  };
  await db.insert(projects).values([
    { ...project, id: PROJECT.alpha, workspaceId: WS.ana, name: "Alpha", createdBy: USERS.ana },
    { ...project, id: PROJECT.bravo, workspaceId: WS.ben, name: "Bravo", createdBy: USERS.ben },
  ]);
  const entry = { entityType: "project", action: "project.created" };
  await db.insert(auditLogs).values([
    {
      ...entry,
      workspaceId: WS.ana,
      actorId: USERS.ana,
      actorName: "Ana",
      entityId: PROJECT.alpha,
    },
    {
      ...entry,
      workspaceId: WS.ben,
      actorId: USERS.ben,
      actorName: "Ben",
      entityId: PROJECT.bravo,
    },
  ]);

  /** One transaction as `userId`, exactly like `withUser`. */
  const as = <T>(userId: string, fn: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(actAs({ userId }));
      return fn(tx);
    });
  const asAnon = <T>(fn: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon`);
      return fn(tx);
    });
  return { pg, db, as, asAnon };
}

/** The database's message when `work` fails, or "succeeded". */
export async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "succeeded";
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
}

/** The Postgres error behind `err` (drizzle wraps it as `cause`), if any. */
const pgError = (err: unknown) => {
  type E = { code?: string; message?: string; cause?: unknown };
  for (let e = err as E | undefined; e; e = e.cause as E | undefined)
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e as E;
  return undefined;
};

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (err) {
    return err;
  }
  throw new Error("Expected the statement to be refused, but it succeeded");
}

/**
 * Asserts `work` was refused by row-level security (Postgres 42501, "violates row-level security
 * policy", or the FORBIDDEN the repositories map it to), not by some other error such as a missing column, a NOT NULL or a foreign-key violation.
 */
export async function expectRlsRefusal(work: Promise<unknown>): Promise<void> {
  const err = (await rejection(work)) as Error & { cause?: Error; code?: string };
  const detail = `${err.message} ${err.cause?.message ?? ""}`;
  // The repositories turn a 42501 into FORBIDDEN (src/db/scope.ts, isRlsDenial); nothing else does.
  const mapped = err.code === "FORBIDDEN" && err.message === "You don't have access to do that";
  if (!mapped && pgError(err)?.code !== "42501" && !/row-level security/i.test(detail))
    throw new Error(`Expected an RLS refusal (42501), got: ${detail.slice(-300)}`);
}

/** Asserts `work` failed with this Postgres error code (23503 foreign key, 23505 unique, …). */
export async function expectPgCode(work: Promise<unknown>, code: string): Promise<void> {
  const err = (await rejection(work)) as Error & { cause?: Error };
  if (pgError(err)?.code !== code)
    throw new Error(
      `Expected Postgres error ${code}, got ${pgError(err)?.code ?? "none"}: ${(err.cause?.message ?? err.message).slice(-300)}`,
    );
}

export const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
