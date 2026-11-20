import { and, asc, count, eq } from "drizzle-orm";

import { sprintItems, sprints, sprintSettings } from "@/src/db/schema";
import { inUserTx, isUuid, lockProject, withDates } from "@/src/db/scope";

import type { SprintRepository } from "./repository";
import type { Sprint, SprintItem } from "./schema";

const toSprint = (r: typeof sprints.$inferSelect): Sprint => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const toItem = (r: typeof sprintItems.$inferSelect): SprintItem => ({
  ...r,
  updatedAt: r.updatedAt.toISOString(),
});
const DATES = ["createdAt", "updatedAt"] as const;
const rowsOf = <T extends Record<string, unknown>>(rows: T[], workspaceId: string) =>
  rows.map((r) => ({ ...withDates(r, DATES), workspaceId })) as never;

/** Supabase Postgres, as the signed-in user (PF-074, ADR-030). */
export const pgSprints: SprintRepository = {
  load: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return { settings: null, sprints: [], items: [] };
      const ws = scope.workspace.id;
      const [settings, s, i] = await Promise.all([
        tx
          .select()
          .from(sprintSettings)
          .where(and(eq(sprintSettings.workspaceId, ws), eq(sprintSettings.projectId, projectId))),
        tx
          .select()
          .from(sprints)
          .where(and(eq(sprints.workspaceId, ws), eq(sprints.projectId, projectId)))
          .orderBy(asc(sprints.number)),
        tx
          .select()
          .from(sprintItems)
          .where(and(eq(sprintItems.workspaceId, ws), eq(sprintItems.projectId, projectId)))
          .orderBy(asc(sprintItems.sprintNumber), asc(sprintItems.position)),
      ]);
      const row = settings[0];
      return {
        settings: row ? { ...row, updatedAt: row.updatedAt.toISOString() } : null,
        sprints: s.map(toSprint),
        items: i.map(toItem),
      };
    }),

  saveSettings: (scope, row, followVelocity) =>
    inUserTx(scope, async (tx) => {
      const values = {
        ...row,
        workspaceId: scope.workspace.id,
        updatedAt: new Date(row.updatedAt),
      };
      await tx
        .insert(sprintSettings)
        .values(values)
        .onConflictDoUpdate({
          target: sprintSettings.projectId,
          set: {
            velocity: values.velocity,
            startDate: values.startDate,
            updatedAt: values.updatedAt,
          },
        });
      // Sprints still at the old velocity follow the new one; ones the PM changed keep theirs.
      if (followVelocity)
        await tx
          .update(sprints)
          .set({ capacityPoints: row.velocity, updatedAt: values.updatedAt })
          .where(
            and(
              eq(sprints.workspaceId, scope.workspace.id),
              eq(sprints.projectId, row.projectId),
              eq(sprints.capacityPoints, followVelocity.from),
            ),
          );
    }),

  replacePlan: (scope, projectId, next, items) =>
    inUserTx(scope, async (tx) => {
      const ws = scope.workspace.id;
      // Placements go with their sprints (foreign key, cascade).
      await tx
        .delete(sprints)
        .where(and(eq(sprints.workspaceId, ws), eq(sprints.projectId, projectId)));
      if (next.length) await tx.insert(sprints).values(rowsOf(next, ws));
      if (items.length) await tx.insert(sprintItems).values(rowsOf(items, ws));
    }),

  moveStory: (scope, projectId, storyCode, sprint, create, updatedAt) =>
    inUserTx(scope, async (tx) => {
      const ws = scope.workspace.id;
      await lockProject(tx, projectId);
      await tx
        .delete(sprintItems)
        .where(
          and(
            eq(sprintItems.workspaceId, ws),
            eq(sprintItems.projectId, projectId),
            eq(sprintItems.storyCode, storyCode),
          ),
        );
      if (create) await tx.insert(sprints).values(rowsOf([create], ws));
      if (!sprint) return;
      const [{ n }] = await tx
        .select({ n: count() })
        .from(sprintItems)
        .where(
          and(eq(sprintItems.projectId, projectId), eq(sprintItems.sprintNumber, sprint.number)),
        );
      await tx.insert(sprintItems).values({
        workspaceId: ws,
        projectId,
        storyCode,
        sprintNumber: sprint.number,
        position: n ?? 0,
        pinned: true,
        reason: "Placed by hand",
        updatedAt: new Date(updatedAt),
      });
    }),

  findSprint: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(sprints)
        .where(and(eq(sprints.workspaceId, scope.workspace.id), eq(sprints.id, id)));
      return row ? toSprint(row) : null;
    }),

  updateSprint: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const { id: _id, workspaceId: _ws, projectId: _p, number: _n, ...rest } = patch;
      const [row] = await tx
        .update(sprints)
        .set(withDates(rest, DATES) as never)
        .where(and(eq(sprints.workspaceId, scope.workspace.id), eq(sprints.id, id)))
        .returning();
      return row ? toSprint(row) : null;
    }),
};
