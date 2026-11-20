import { and, asc, eq, max } from "drizzle-orm";

import { prds } from "@/src/db/schema";
import { inUserTx, isUniqueViolation, isUuid, lockProject, withDates } from "@/src/db/scope";
import { AppError } from "@/src/lib/errors";

import type { PrdRepository } from "./repository";
import { DRAFT_OPEN, type Prd } from "./schema";

const toPrd = (r: typeof prds.$inferSelect): Prd => ({
  id: r.id,
  workspaceId: r.workspaceId,
  projectId: r.projectId,
  version: r.version,
  content: r.content,
  status: r.status as Prd["status"],
  origin: r.origin,
  agentRunId: r.agentRunId,
  basedOnVersion: r.basedOnVersion,
  // Null once the author's account is deleted.
  createdBy: r.createdBy ?? "",
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  approvedBy: r.approvedBy,
  approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
});

const DATES = ["createdAt", "updatedAt", "approvedAt"] as const;

/** Supabase Postgres, as the signed-in user (PF-072, ADR-028). */
export const pgPrds: PrdRepository = {
  listByProject: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return [];
      const rows = await tx
        .select()
        .from(prds)
        .where(and(eq(prds.workspaceId, scope.workspace.id), eq(prds.projectId, projectId)))
        .orderBy(asc(prds.version));
      return rows.map(toPrd);
    }),

  findById: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(prds)
        .where(and(eq(prds.workspaceId, scope.workspace.id), eq(prds.id, id)));
      return row ? toPrd(row) : null;
    }),

  insertVersion: (scope, prd) =>
    inUserTx(scope, async (tx) => {
      await lockProject(tx, prd.projectId);
      const [{ latest } = { latest: null }] = await tx
        .select({ latest: max(prds.version) })
        .from(prds)
        .where(and(eq(prds.workspaceId, scope.workspace.id), eq(prds.projectId, prd.projectId)));
      try {
        const [row] = await tx
          .insert(prds)
          .values({
            ...withDates(prd, DATES),
            workspaceId: scope.workspace.id,
            version: (latest ?? 0) + 1,
            createdBy: scope.session.userId,
          } as typeof prds.$inferInsert)
          .returning();
        return toPrd(row!);
      } catch (err) {
        if (isUniqueViolation(err, "prds_one_draft")) throw new AppError("CONFLICT", DRAFT_OPEN);
        throw err;
      }
    }),

  updateDraft: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const {
        id: _id,
        workspaceId: _ws,
        projectId: _p,
        version: _v,
        createdBy: _by,
        ...rest
      } = patch;
      const [row] = await tx
        .update(prds)
        .set(withDates(rest, DATES) as Partial<typeof prds.$inferInsert>)
        .where(
          and(eq(prds.workspaceId, scope.workspace.id), eq(prds.id, id), eq(prds.status, "DRAFT")),
        )
        .returning();
      return row ? toPrd(row) : null;
    }),
};
