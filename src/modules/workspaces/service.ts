import { cache } from "react";

import { dataBackend, type Scope, unitOfWork } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { AppError } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { ttlCache } from "@/src/lib/ttl-cache";
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
 * The signed-in user's workspace context. Route handlers and server pages start here. Also cached
 * per request (React `cache`), so a layout and its page share one lookup.
 */
export const currentContext = cache(async (): Promise<WorkspaceContext> => {
  // Imported here rather than at module scope: `src/lib/session` pulls in `next/headers`, which exists only
  // inside a Next request. Scripts (`pnpm db:seed`) import `ensureWorkspace` from this file and must not load it.
  const { getSession } = await import("@/src/lib/session");
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED", "Please sign in");
  if (dataBackend() !== "postgres") return ensureWorkspace(session);

  const known = contexts.get(session.userId);
  // The session comes fresh from the verified token every time; only the lookup is reused.
  if (known) return { ...known, session };
  const ctx = await ensureWorkspace(session);
  contexts.set(session.userId, { workspace: ctx.workspace, role: ctx.role });
  return ctx;
});
