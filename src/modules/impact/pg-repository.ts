import { and, asc, eq, max } from "drizzle-orm";

import { impactReviews, requirementChanges } from "@/src/db/schema";
import { inUserTx, iso, isUuid, lockProject, withDates } from "@/src/db/scope";

import type { ImpactRepository } from "./repository";
import type { ImpactReview, RequirementChange } from "./schema";

const toChange = (r: typeof requirementChanges.$inferSelect): RequirementChange => ({
  ...r,
  status: r.status as RequirementChange["status"],
  createdAt: r.createdAt.toISOString(),
  decidedAt: iso(r.decidedAt),
});
const toReview = (r: typeof impactReviews.$inferSelect): ImpactReview => ({
  ...r,
  ref: r.ref as ImpactReview["ref"],
  reviewedAt: r.reviewedAt.toISOString(),
});
const DATES = ["createdAt", "decidedAt"] as const;

/** Supabase Postgres, as the signed-in user (PF-074, ADR-030). */
export const pgChanges: ImpactRepository = {
  load: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return { changes: [], reviews: [] };
      const ws = scope.workspace.id;
      const [changes, reviews] = await Promise.all([
        tx
          .select()
          .from(requirementChanges)
          .where(
            and(
              eq(requirementChanges.workspaceId, ws),
              eq(requirementChanges.projectId, projectId),
            ),
          )
          .orderBy(asc(requirementChanges.number)),
        tx
          .select()
          .from(impactReviews)
          .where(and(eq(impactReviews.workspaceId, ws), eq(impactReviews.projectId, projectId))),
      ]);
      return { changes: changes.map(toChange), reviews: reviews.map(toReview) };
    }),

  find: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(requirementChanges)
        .where(
          and(
            eq(requirementChanges.workspaceId, scope.workspace.id),
            eq(requirementChanges.id, id),
          ),
        );
      return row ? toChange(row) : null;
    }),

  insert: (scope, row) =>
    inUserTx(scope, async (tx) => {
      await lockProject(tx, row.projectId);
      const [{ latest } = { latest: null }] = await tx
        .select({ latest: max(requirementChanges.number) })
        .from(requirementChanges)
        .where(eq(requirementChanges.projectId, row.projectId));
      const [saved] = await tx
        .insert(requirementChanges)
        .values({
          ...withDates(row, DATES),
          workspaceId: scope.workspace.id,
          number: (latest ?? 0) + 1,
        } as never)
        .returning();
      return toChange(saved!);
    }),

  update: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const { id: _id, workspaceId: _ws, projectId: _p, number: _n, ...rest } = patch;
      const [row] = await tx
        .update(requirementChanges)
        .set(withDates(rest, DATES) as never)
        .where(
          and(
            eq(requirementChanges.workspaceId, scope.workspace.id),
            eq(requirementChanges.id, id),
            eq(requirementChanges.status, "DRAFT"),
          ),
        )
        .returning();
      return row ? toChange(row) : null;
    }),

  addReview: (scope, review) =>
    inUserTx(scope, async (tx) => {
      await tx
        .insert(impactReviews)
        .values({
          ...review,
          workspaceId: scope.workspace.id,
          reviewedAt: new Date(review.reviewedAt),
        })
        .onConflictDoNothing();
    }),
};
