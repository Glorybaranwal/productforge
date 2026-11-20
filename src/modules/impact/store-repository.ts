import { readState, transact } from "@/src/db/store";

import type { ImpactRepository } from "./repository";

const mine =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

/** Change requests and review marks (PF-053). Scoped by workspace, mirroring RLS. */
export const storeChanges: ImpactRepository = {
  async load(scope, projectId) {
    const workspaceId = scope.workspace.id;
    const state = await readState();
    const own = mine(workspaceId, projectId);
    return {
      changes: state.changes.filter(own).sort((a, b) => a.number - b.number),
      reviews: state.impactReviews.filter(own),
    };
  },

  async find(scope, id) {
    const workspaceId = scope.workspace.id;
    const state = await readState();
    return state.changes.find((c) => c.workspaceId === workspaceId && c.id === id) ?? null;
  },

  /** Inserts with the next CR number for the project. */
  async insert(_scope, row) {
    return transact((state) => {
      const own = mine(row.workspaceId, row.projectId);
      const number = Math.max(0, ...state.changes.filter(own).map((c) => c.number)) + 1;
      const change = { ...row, number };
      state.changes.push(change);
      return change;
    });
  },

  /** Updates a proposed change (DRAFT only); decided changes are frozen. */
  async update(scope, id, patch) {
    const workspaceId = scope.workspace.id;
    return transact((state) => {
      const row = state.changes.find((c) => c.workspaceId === workspaceId && c.id === id);
      if (!row || row.status !== "DRAFT") return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },

  async addReview(_scope, review) {
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
