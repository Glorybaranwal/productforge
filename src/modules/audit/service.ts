import { newId, nowIso } from "@/src/lib/ids";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { auditRepository } from "./repository";
import type { AuditLog } from "./schema";

export type AuditEvent = {
  entityType: string;
  entityId: string;
  action: string;
  diff?: Record<string, unknown> | null;
};

/**
 * Appends an audit entry for the acting user (PRD NFR: audit log for edits, approvals, exports).
 * Inside a unit of work it joins that transaction, so the change and its entry save together.
 */
export async function recordAudit(ctx: WorkspaceContext, event: AuditEvent): Promise<AuditLog> {
  return auditRepository.insert(ctx, {
    id: newId(),
    workspaceId: ctx.workspace.id,
    actorId: ctx.session.userId,
    actorName: ctx.session.name,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    diff: event.diff ?? null,
    createdAt: nowIso(),
  });
}

export async function listAudit(
  ctx: WorkspaceContext,
  entityType: string,
  entityId: string,
): Promise<AuditLog[]> {
  return auditRepository.listForEntity(ctx, ctx.workspace.id, entityType, entityId);
}
