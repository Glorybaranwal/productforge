import { readState, transact } from "@/src/db/store";

import type { ImpactReview, RequirementChange } from "./schema";

const mine =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

export type ChangeRows = { changes: RequirementChange[]; reviews: ImpactReview[] };

/** Change requests and review marks (PF-053). Scoped by workspace, mirroring RLS. */
export const impactRepository = {
  async load(workspaceId: string, projectId: string): Promise<ChangeRows> {
    const state = await readState();
    const own = mine(workspaceId, projectId);
    return {
      changes: state.changes.filter(own).sort((a, b) => a.number - b.number),
      reviews: state.impactReviews.filter(own),
    };
  },

  async find(workspaceId: string, id: string): Promise<RequirementChange | null> {
    const state = await readState();
    return state.changes.find((c) => c.workspaceId === workspaceId && c.id === id) ?? null;
  },

  /** Inserts with the next CR number for the project. */
  async insert(row: Omit<RequirementChange, "number">): Promise<RequirementChange> {
    return transact((state) => {
      const own = mine(row.workspaceId, row.projectId);
      const number = Math.max(0, ...state.changes.filter(own).map((c) => c.number)) + 1;
      const change = { ...row, number };
      state.changes.push(change);
      return change;
    });
  },

  /** Updates a proposed change (DRAFT only); decided changes are frozen. */
  async update(
    workspaceId: string,
    id: string,
    patch: Partial<RequirementChange>,
  ): Promise<RequirementChange | null> {
    return transact((state) => {
      const row = state.changes.find((c) => c.workspaceId === workspaceId && c.id === id);
      if (!row || row.status !== "DRAFT") return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },

  async addReview(review: ImpactReview): Promise<void> {
    await transact((state) => {
      const exists = state.impactReviews.some(
        (r) =>
          r.workspaceId === review.workspaceId &&
          r.changeId === review.changeId &&
          r.ref === review.ref,
      );
      if (!exists) state.impactReviews.push(review);
    });
  },
};
