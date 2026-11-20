import { and, asc, eq, inArray } from "drizzle-orm";

import type { Tx } from "@/src/db/client";
import { acceptanceCriteria, epics, stories, technicalTasks } from "@/src/db/schema";
import { inUserTx, isUniqueViolation, isUuid, withDates } from "@/src/db/scope";
import { AppError } from "@/src/lib/errors";

import type { BacklogRepository } from "./repository";
import type { AcceptanceCriterion, Epic, Story, TechnicalTask } from "./schema";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const DATES = ["createdAt", "updatedAt", "approvedAt"] as const;
const BUSY = "Someone else just changed this backlog — reload and try again";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

const base = (r: Row<typeof epics> | Row<typeof stories> | Row<typeof acceptanceCriteria>) => ({
  id: r.id,
  workspaceId: r.workspaceId,
  projectId: r.projectId,
  status: r.status,
  evidence: r.evidence,
  origin: r.origin,
  agentRunId: r.agentRunId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const toEpic = (r: Row<typeof epics>): Epic => ({
  ...base(r),
  code: r.code,
  title: r.title,
  description: r.description,
});

const toStory = (r: Row<typeof stories>): Story => ({
  ...base(r),
  epicId: r.epicId,
  code: r.code,
  version: r.version,
  basedOnVersion: r.basedOnVersion,
  title: r.title,
  asA: r.asA,
  iWant: r.iWant,
  soThat: r.soThat,
  priority: r.priority,
  storyPoints: r.storyPoints as Story["storyPoints"],
  requirementCodes: r.requirementCodes,
  dependsOn: r.dependsOn,
  rationale: r.rationale,
  rejectionReason: r.rejectionReason,
  prdVersion: r.prdVersion,
  // Null once the author's account is deleted.
  createdBy: r.createdBy ?? "",
  approvedBy: r.approvedBy,
  approvedAt: iso(r.approvedAt),
});

const toCriterion = (r: Row<typeof acceptanceCriteria>): AcceptanceCriterion => ({
  ...base(r),
  storyId: r.storyId,
  kind: r.kind,
  given: r.given,
  when: r.when,
  then: r.then,
  position: r.position,
});

const toTask = (r: Row<typeof technicalTasks>): TechnicalTask => ({
  ...base(r),
  storyId: r.storyId,
  code: r.code,
  title: r.title,
  description: r.description,
  estimateHours: r.estimateHours,
  position: r.position,
  sprintId: r.sprintId,
});

/** A domain row as column values for `scope`'s workspace: dates as Dates, ids kept. */
function values<T extends Record<string, unknown>>(rows: T[], workspaceId: string) {
  return rows.map((r) => ({ ...withDates(r, DATES), workspaceId }));
}

/** A patch as column values: identity columns never change. */
function patchOf(patch: Record<string, unknown>) {
  const { id: _id, workspaceId: _ws, projectId: _p, storyId: _s, createdBy: _by, ...rest } = patch;
  return withDates(rest, DATES);
}

const storyIn = (workspaceId: string, id: string) =>
  and(eq(stories.workspaceId, workspaceId), eq(stories.id, id));

async function clearChildren(
  tx: Tx,
  storyId: string,
  which: { criteria?: unknown; tasks?: unknown },
) {
  if (which.criteria)
    await tx.delete(acceptanceCriteria).where(eq(acceptanceCriteria.storyId, storyId));
  if (which.tasks) await tx.delete(technicalTasks).where(eq(technicalTasks.storyId, storyId));
}

async function insertChildren(
  tx: Tx,
  workspaceId: string,
  rows: { criteria?: AcceptanceCriterion[]; tasks?: TechnicalTask[] },
) {
  if (rows.criteria?.length)
    await tx.insert(acceptanceCriteria).values(values(rows.criteria, workspaceId) as never);
  if (rows.tasks?.length)
    await tx.insert(technicalTasks).values(values(rows.tasks, workspaceId) as never);
}

/** Supabase Postgres, as the signed-in user (PF-073, ADR-029). */
export const pgBacklog: BacklogRepository = {
  load: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return { epics: [], stories: [], criteria: [], tasks: [] };
      const ws = scope.workspace.id;
      const mine = <
        T extends typeof epics | typeof stories | typeof acceptanceCriteria | typeof technicalTasks,
      >(
        t: T,
      ) => and(eq(t.workspaceId, ws), eq(t.projectId, projectId));
      // Issued together: postgres.js pipelines them on the transaction's connection.
      const [e, s, c, t] = await Promise.all([
        tx.select().from(epics).where(mine(epics)).orderBy(asc(epics.code)),
        tx
          .select()
          .from(stories)
          .where(mine(stories))
          .orderBy(asc(stories.createdAt), asc(stories.code), asc(stories.version)),
        tx
          .select()
          .from(acceptanceCriteria)
          .where(mine(acceptanceCriteria))
          .orderBy(asc(acceptanceCriteria.position), asc(acceptanceCriteria.createdAt)),
        tx
          .select()
          .from(technicalTasks)
          .where(mine(technicalTasks))
          .orderBy(asc(technicalTasks.position), asc(technicalTasks.createdAt)),
      ]);
      return {
        epics: e.map(toEpic),
        stories: s.map(toStory),
        criteria: c.map(toCriterion),
        tasks: t.map(toTask),
      };
    }),

  findStory: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx.select().from(stories).where(storyIn(scope.workspace.id, id));
      return row ? toStory(row) : null;
    }),

  insert: (scope, rows) =>
    inUserTx(scope, async (tx) => {
      const ws = scope.workspace.id;
      try {
        if (rows.epics?.length) await tx.insert(epics).values(values(rows.epics, ws) as never);
        if (rows.stories?.length) {
          const withAuthor = rows.stories.map((s) => ({
            ...s,
            createdBy: isUuid(s.createdBy) ? s.createdBy : scope.session.userId,
          }));
          await tx.insert(stories).values(values(withAuthor, ws) as never);
        }
        await insertChildren(tx, ws, rows);
      } catch (err) {
        const taken = ["epics_project_code_key", "stories_project_code_version_key"];
        if (taken.some((name) => isUniqueViolation(err, name)))
          throw new AppError("CONFLICT", BUSY);
        throw err;
      }
    }),

  updateStory: (scope, id, allowed, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .update(stories)
        .set(patchOf(patch) as never)
        .where(and(storyIn(scope.workspace.id, id), inArray(stories.status, allowed)))
        .returning();
      return row ? toStory(row) : null;
    }),

  replaceChildren: (scope, storyId, children, storyPatch = {}) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(storyId)) return false;
      const [story] = await tx
        .select({ status: stories.status })
        .from(stories)
        .where(storyIn(scope.workspace.id, storyId))
        .for("update");
      if (story?.status !== "DRAFT") return false;
      await clearChildren(tx, storyId, children);
      await insertChildren(tx, scope.workspace.id, children);
      if (Object.keys(storyPatch).length)
        await tx
          .update(stories)
          .set(patchOf(storyPatch) as never)
          .where(storyIn(scope.workspace.id, storyId));
      return true;
    }),

  setStatus: (scope, storyId, from, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(storyId)) return null;
      const [row] = await tx
        .update(stories)
        .set(patchOf(patch) as never)
        .where(and(storyIn(scope.workspace.id, storyId), inArray(stories.status, from)))
        .returning();
      if (!row) return null;
      const children = { status: patch.status, updatedAt: row.updatedAt };
      await tx
        .update(acceptanceCriteria)
        .set(children)
        .where(eq(acceptanceCriteria.storyId, storyId));
      await tx.update(technicalTasks).set(children).where(eq(technicalTasks.storyId, storyId));
      return toStory(row);
    }),

  resetStory: (scope, id, allowed, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .update(stories)
        .set(patchOf(patch) as never)
        .where(and(storyIn(scope.workspace.id, id), inArray(stories.status, allowed)))
        .returning();
      if (!row) return null;
      await clearChildren(tx, id, { criteria: true, tasks: true });
      return toStory(row);
    }),

  updateEpic: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return;
      await tx
        .update(epics)
        .set(patchOf(patch) as never)
        .where(and(eq(epics.workspaceId, scope.workspace.id), eq(epics.id, id)));
    }),
};
