import { readState, transact } from "@/src/db/store";
import { AppError } from "@/src/lib/errors";

import type { PrdRepository } from "./repository";
import { DRAFT_OPEN, type Prd } from "./schema";

const ofProject = (workspaceId: string, projectId: string) => (p: Prd) =>
  p.workspaceId === workspaceId && p.projectId === projectId;

/** The demo store (ADR-011): same rules as Postgres, in one process. */
export const storePrds: PrdRepository = {
  async listByProject(scope, projectId) {
    const state = await readState();
    return state.prds
      .filter(ofProject(scope.workspace.id, projectId))
      .sort((a, b) => a.version - b.version);
  },

  async findById(scope, id) {
    const state = await readState();
    return state.prds.find((p) => p.workspaceId === scope.workspace.id && p.id === id) ?? null;
  },

  async insertVersion(scope, prd) {
    return transact((state) => {
      const versions = state.prds.filter(ofProject(scope.workspace.id, prd.projectId));
      if (versions.some((p) => p.status === "DRAFT")) throw new AppError("CONFLICT", DRAFT_OPEN);
      const row: Prd = {
        ...prd,
        workspaceId: scope.workspace.id,
        version: versions.reduce((n, p) => Math.max(n, p.version), 0) + 1,
      };
      state.prds.push(row);
      return row;
    });
  },

  async updateDraft(scope, id, patch) {
    return transact((state) => {
      const row = state.prds.find((p) => p.workspaceId === scope.workspace.id && p.id === id);
      if (!row || row.status !== "DRAFT") return null;
      const { id: _id, workspaceId: _ws, projectId: _p, version: _v, ...rest } = patch;
      Object.assign(row, rest);
      return { ...row };
    });
  },
};
