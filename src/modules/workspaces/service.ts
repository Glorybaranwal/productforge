import { cache } from "react";

import { dataBackend, type Scope, unitOfWork } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { AppError } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { checkRateLimit, principalOf } from "@/src/lib/rate-limit";
import { ttlCache } from "@/src/lib/ttl-cache";
import { contextForApiKey } from "@/src/modules/api-keys/service";
import { recordAudit } from "@/src/modules/audit/service";

import { workspaceRepository } from "./repository";
import type { WorkspaceContext } from "./schema";

/**
 * Gets (or on first visit creates) the user's workspace and their role in it (PF-015). Creating
 * the workspace, the owner's membership and the audit entry is one unit of work.
 */
export async function ensureWorkspace(session: Session): Promise<WorkspaceContext> {
  const start: Scope = { session };
  return unitOfWork(start, async (scope) => {
    const { workspace, member, created } = await workspaceRepository.ensureDefault(
      scope,
      session.userId,
      () => {
        const createdAt = nowIso();
        const workspace = { id: newId(), name: "My workspace", ownerId: session.userId, createdAt };
        return {
          workspace,
          member: {
            workspaceId: workspace.id,
            userId: session.userId,
            role: "owner" as const,
            createdAt,
          },
        };
      },
    );

    const ctx: WorkspaceContext = { session, workspace, role: member.role };
    if (created) {
      await recordAudit(
        { ...ctx, tx: scope.tx },
        { entityType: "workspace", entityId: workspace.id, action: "workspace.created" },
      );
    }
    // The transaction ends with this unit of work, so the returned context doesn't carry it.
    return ctx;
  });
}

/**
 * In Postgres mode a user's workspace and role are remembered for 30 s across requests, saving a
 * transaction per click (ADR-023). Safe because RLS checks membership and role on every query
 * anyway; the cost is that a role change can take up to 30 s to show in the UI. Call
 * `forgetContext` when a membership changes.
 */
const CONTEXT_TTL_MS = 30_000;
const contexts = ttlCache<Omit<WorkspaceContext, "session">>(
  "__productforgeContexts",
  CONTEXT_TTL_MS,
);

export function forgetContext(userId: string): void {
  contexts.delete(userId);
}

/**
 * Counts this request against its rate-limit class (PF-084, ADR-037). Only `/api` requests carry a
 * class (`proxy.ts` stamps it), so a page render is never metered and costs nothing here. No
 * `DATABASE_URL` means demo mode, where there is nothing to count in.
 *
 * Do NOT wrap `checkRateLimit` in a try/catch: it already fails open on a counter failure, and a
 * caller-side catch would swallow its deliberate RATE_LIMITED and silently disable the limiter.
 */
async function meter(principal: string): Promise<void> {
  // Lazy like `apiKeyFromRequest`: it reads `next/headers`, which `pnpm db:seed` must not load.
  const { rateBucketFromRequest } = await import("@/src/lib/request-key");
  const bucket = await rateBucketFromRequest();
  if (bucket && process.env.DATABASE_URL) await checkRateLimit(principal, bucket);
}

/**
 * The signed-in user's workspace context. Route handlers and server pages start here. Also cached
 * per request (React `cache`), so a layout and its page share one lookup.
 *
 * A request to `/api/*` that carries an API key (PF-083, ADR-036) is authenticated as the member who
 * created the key instead, and never falls back to a cookie: a bad key is a 401. The key's role is
 * read from the membership on every request, so it skips the 30 s cache below.
 */
export const currentContext = cache(async (): Promise<WorkspaceContext> => {
  // Lazy for the same reason as `getSession`: it reads `next/headers`.
  const { apiKeyFromRequest } = await import("@/src/lib/request-key");
  const keyed = await apiKeyFromRequest();
  if (keyed) {
    const ctx = await contextForApiKey(keyed.header, { mutating: keyed.mutating });
    // After the key is verified, so a bad key costs no counter write. It meters as itself.
    await meter(principalOf(ctx));
    return ctx;
  }

  // Imported here rather than at module scope: `src/lib/session` pulls in `next/headers`, which exists only
  // inside a Next request. Scripts (`pnpm db:seed`) import `ensureWorkspace` from this file and must not load it.
  const { getSession } = await import("@/src/lib/session");
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED", "Please sign in");
  await meter(principalOf({ session }));
  if (dataBackend() !== "postgres") return ensureWorkspace(session);

  const known = contexts.get(session.userId);
  // The session comes fresh from the verified token every time; only the lookup is reused.
  if (known) return { ...known, session };
  const ctx = await ensureWorkspace(session);
  contexts.set(session.userId, { workspace: ctx.workspace, role: ctx.role });
  return ctx;
});
