import { readState, transact } from "@/src/db/store";

import type { Prd } from "./schema";

const ofProject = (workspaceId: string, projectId: string) => (p: Prd) =>
  p.workspaceId === workspaceId && p.projectId === projectId;

/** PRD versions are append-only once approved (ADR-006): approved rows are never updated. */
export const prdRepository = {
  async listByProject(workspaceId: string, projectId: string): Promise<Prd[]> {
    const state = await readState();
    return state.prds
      .filter(ofProject(workspaceId, projectId))
      .sort((a, b) => a.version - b.version);
  },

  async findById(workspaceId: string, id: string): Promise<Prd | null> {
    const state = await readState();
    return state.prds.find((p) => p.workspaceId === workspaceId && p.id === id) ?? null;
  },

  /** Inserts the next version number for the project. */
  async insertVersion(prd: Omit<Prd, "version">): Promise<Prd> {
    return transact((state) => {
      const versions = state.prds.filter(ofProject(prd.workspaceId, prd.projectId));
      const row: Prd = {
        ...prd,
        version: versions.reduce((n, p) => Math.max(n, p.version), 0) + 1,
      };
      state.prds.push(row);
      return row;
    });
  },

  /** Updates a DRAFT only; returns null if it's missing or already approved. */
  async updateDraft(workspaceId: string, id: string, patch: Partial<Prd>): Promise<Prd | null> {
    return transact((state) => {
      const row = state.prds.find((p) => p.workspaceId === workspaceId && p.id === id);
      if (!row || row.status !== "DRAFT") return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },
};
