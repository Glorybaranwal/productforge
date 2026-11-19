import { asc, eq, sql } from "drizzle-orm";

import { workspaceMembers, workspaces } from "@/src/db/schema";
import { inUserTx, isUuid } from "@/src/db/scope";

import type { WorkspaceRepository } from "./repository";
import type { Workspace, WorkspaceMember } from "./schema";

const toWorkspace = (row: typeof workspaces.$inferSelect): Workspace => ({
  id: row.id,
  name: row.name,
  ownerId: row.ownerId,
  createdAt: row.createdAt.toISOString(),
});

const toMember = (row: typeof workspaceMembers.$inferSelect): WorkspaceMember => ({
  workspaceId: row.workspaceId,
  userId: row.userId,
  role: row.role,
  createdAt: row.createdAt.toISOString(),
});

/** Supabase Postgres, as the signed-in user: RLS applies to every statement (PF-015, ADR-022). */
export const pgWorkspaces: WorkspaceRepository = {
  findById: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
      return row ? toWorkspace(row) : null;
    }),

  membershipsForUser: (scope, userId) =>
    inUserTx(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId))
        .orderBy(asc(workspaceMembers.createdAt));
      return rows.map(toMember);
    }),

  ensureDefault: (scope, userId, make) =>
    inUserTx(scope, async (tx) => {
      const first = async () => {
        const [row] = await tx
          .select({ workspace: workspaces, member: workspaceMembers })
          .from(workspaceMembers)
          .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(eq(workspaceMembers.userId, userId))
          .orderBy(asc(workspaceMembers.createdAt))
          .limit(1);
        return row;
      };
      let found = await first();
      if (!found) {
        // First visit: the layout and the page may both get here. The lock (released when the
        // transaction ends) makes the second wait, then find the first one's workspace.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
        found = await first();
      }
      if (found) {
        return {
          workspace: toWorkspace(found.workspace),
          member: toMember(found.member),
          created: false,
        };
      }

      const fresh = make();
      const createdAt = new Date(fresh.workspace.createdAt);
      await tx.insert(workspaces).values({
        id: fresh.workspace.id,
        name: fresh.workspace.name,
        ownerId: fresh.workspace.ownerId,
        createdAt,
        updatedAt: createdAt,
      });
      await tx.insert(workspaceMembers).values({
        workspaceId: fresh.member.workspaceId,
        userId: fresh.member.userId,
        role: fresh.member.role,
        createdAt: new Date(fresh.member.createdAt),
      });
      return { ...fresh, created: true };
    }),
};
