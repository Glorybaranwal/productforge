import { and, desc, eq } from "drizzle-orm";

import { projects } from "@/src/db/schema";
import { inUserTx, isUuid } from "@/src/db/scope";

import type { ProjectRepository } from "./repository";
import type { Project } from "./schema";

const toProject = (row: typeof projects.$inferSelect): Project => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  domain: row.domain,
  audience: row.audience,
  teamSize: row.teamSize,
  sprintLengthDays: row.sprintLengthDays,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const inWorkspace = (workspaceId: string, id: string) =>
  and(eq(projects.workspaceId, workspaceId), eq(projects.id, id));

/**
 * Supabase Postgres, as the signed-in user (PF-015, ADR-022). Queries still name the workspace —
 * RLS is the backstop, not the filter — so a project is never found through the wrong workspace.
 */
export const pgProjects: ProjectRepository = {
  listByWorkspace: (scope, workspaceId) =>
    inUserTx(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId))
        .orderBy(desc(projects.updatedAt), desc(projects.createdAt));
      return rows.map(toProject);
    }),

  findById: (scope, workspaceId, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx.select().from(projects).where(inWorkspace(workspaceId, id)).limit(1);
      return row ? toProject(row) : null;
    }),

  insert: (scope, project) =>
    inUserTx(scope, async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({
          ...project,
          createdAt: new Date(project.createdAt),
          updatedAt: new Date(project.updatedAt),
        })
        .returning();
      return toProject(row!);
    }),

  update: (scope, workspaceId, id, patch, updatedAt) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .update(projects)
        .set({ ...patch, updatedAt: new Date(updatedAt) })
        .where(inWorkspace(workspaceId, id))
        .returning();
      return row ? toProject(row) : null;
    }),

  remove: (scope, workspaceId, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return false;
      const removed = await tx
        .delete(projects)
        .where(inWorkspace(workspaceId, id))
        .returning({ id: projects.id });
      return removed.length > 0;
    }),
};
