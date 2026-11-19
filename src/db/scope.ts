/**
 * Where workspaces, projects and the audit trail live, and the transaction a repository call runs
 * in (PF-015, ADR-022). Server only.
 *
 * `DATA_DRIVER=postgres` keeps them in Supabase Postgres, read and written as the signed-in user so
 * RLS applies (ADR-020). Anything else keeps them in the demo store (ADR-011). Modules without
 * tables yet stay in the demo store either way.
 */
import type { Session } from "@/src/lib/auth";
import { AppError } from "@/src/lib/errors";
import { logger } from "@/src/lib/logger";
import { authDriver } from "@/src/lib/supabase/config";

import { type DbSession, type Tx, withUser } from "./client";

export type DataBackend = "store" | "postgres";

/** Who is acting, and the open transaction if a unit of work started one. */
export type Scope = { session: Session; tx?: Tx };

type Env = Record<string, string | undefined>;

export function dataBackend(env: Env = process.env): DataBackend {
  if (env.DATA_DRIVER !== "postgres") return "store";
  // RLS needs a real Supabase user; demo mode's user doesn't exist in auth.users.
  if (authDriver(env) !== "supabase") {
    throw new Error(
      "DATA_DRIVER=postgres needs Supabase sign-in (ADR-021): unset AUTH_DRIVER=demo",
    );
  }
  return "postgres";
}

export type UserRunner = <T>(session: DbSession, fn: (tx: Tx) => Promise<T>) => Promise<T>;
let runAsUser: UserRunner = withUser;

/** Tests run the Postgres repositories on PGlite. `null` restores `withUser`. */
export function setUserRunner(runner: UserRunner | null): void {
  runAsUser = runner ?? withUser;
}

const dbSession = (session: Session): DbSession => ({
  userId: session.userId,
  email: session.email || null,
});

/** Postgres refused a write under RLS: the app's own role check should have caught it first. */
function isRlsDenial(err: unknown): boolean {
  for (let e = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "42501") return true;
  }
  return false;
}

/** A transaction slower than this is logged, so performance regressions show up (ADR-023). */
export const SLOW_TX_MS = 1500;

async function run<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await runAsUser(dbSession(scope.session), fn);
  } catch (err) {
    if (isRlsDenial(err)) throw new AppError("FORBIDDEN", "You don't have access to do that");
    throw err;
  } finally {
    const ms = Math.round(performance.now() - started);
    if (ms >= SLOW_TX_MS) logger.warn("Slow database transaction", { ms });
    else logger.debug("Database transaction", { ms });
  }
}

/** Runs `fn` in the scope's open transaction, or in a new one as the scope's user. */
export function inUserTx<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return scope.tx ? fn(scope.tx) : run(scope, fn);
}

/**
 * Makes several repository calls one transaction in Postgres: all saved or none (e.g. a project and
 * its audit entry). The demo store just runs them.
 */
export function unitOfWork<S extends Scope, T>(scope: S, fn: (scope: S) => Promise<T>): Promise<T> {
  if (scope.tx || dataBackend() !== "postgres") return fn(scope);
  return run(scope, (tx) => fn({ ...scope, tx }));
}

/** Postgres rejects malformed uuids with an error; a lookup by one simply finds nothing. */
export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
