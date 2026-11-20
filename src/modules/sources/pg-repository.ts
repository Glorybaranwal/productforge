import { and, asc, eq } from "drizzle-orm";

import { sourceDocuments } from "@/src/db/schema";
import { inUserTx, isUuid } from "@/src/db/scope";

import type { SourceRepository } from "./repository";
import type { SourceDocument } from "./schema";

const toSource = (s: typeof sourceDocuments.$inferSelect): SourceDocument => ({
  id: s.id,
  workspaceId: s.workspaceId,
  projectId: s.projectId,
  name: s.name,
  kind: s.kind,
  text: s.text,
  charCount: s.charCount,
  // Null once the author's account is deleted.
  createdBy: s.createdBy ?? "",
  createdAt: s.createdAt.toISOString(),
});

/** Supabase Postgres, as the signed-in user (PF-070, ADR-026). */
export const pgSources: SourceRepository = {
  listByProject: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return [];
      const rows = await tx
        .select()
        .from(sourceDocuments)
        .where(
          and(
            eq(sourceDocuments.workspaceId, scope.workspace.id),
            eq(sourceDocuments.projectId, projectId),
          ),
        )
        .orderBy(asc(sourceDocuments.createdAt));
      return rows.map(toSource);
    }),

  insert: (scope, source) =>
    inUserTx(scope, async (tx) => {
      const [row] = await tx
        .insert(sourceDocuments)
        .values({ ...source, createdAt: new Date(source.createdAt) })
        .returning();
      return toSource(row!);
    }),

  remove: (scope, projectId, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId) || !isUuid(id)) return false;
      const removed = await tx
        .delete(sourceDocuments)
        .where(
          and(
            eq(sourceDocuments.workspaceId, scope.workspace.id),
            eq(sourceDocuments.projectId, projectId),
            eq(sourceDocuments.id, id),
          ),
        )
        .returning({ id: sourceDocuments.id });
      return removed.length > 0;
    }),
};
