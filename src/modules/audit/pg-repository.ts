import { and, desc, eq } from "drizzle-orm";

import { auditLogs } from "@/src/db/schema";
import { inUserTx } from "@/src/db/scope";

import type { AuditRepository } from "./repository";
import type { AuditLog } from "./schema";

const toEntry = (row: typeof auditLogs.$inferSelect): AuditLog => ({
  id: row.id,
  workspaceId: row.workspaceId,
  actorId: row.actorId,
  actorName: row.actorName,
  entityType: row.entityType,
  entityId: row.entityId,
  action: row.action,
  diff: row.diff ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Supabase Postgres, as the signed-in user: append-only by RLS (no update/delete policy). */
export const pgAudit: AuditRepository = {
  insert: (scope, entry) =>
    inUserTx(scope, async (tx) => {
      const [row] = await tx
        .insert(auditLogs)
        .values({ ...entry, createdAt: new Date(entry.createdAt) })
        .returning();
      return toEntry(row!);
    }),

  listForEntity: (scope, workspaceId, entityType, entityId) =>
    inUserTx(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.entityType, entityType),
            eq(auditLogs.entityId, entityId),
          ),
        )
        .orderBy(desc(auditLogs.createdAt));
      return rows.map(toEntry);
    }),
};
