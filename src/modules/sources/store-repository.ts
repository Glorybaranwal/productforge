import { readState, transact } from "@/src/db/store";

import type { SourceRepository } from "./repository";

/** Demo store (ADR-011). */
export const storeSources: SourceRepository = {
  async listByProject(scope, projectId) {
    const state = await readState();
    return state.sources.filter(
      (s) => s.workspaceId === scope.workspace.id && s.projectId === projectId,
    );
  },

  async insert(_scope, source) {
    return transact((state) => {
      state.sources.push(source);
      return source;
    });
  },

  async remove(scope, projectId, id) {
    return transact((state) => {
      const index = state.sources.findIndex(
        (s) => s.workspaceId === scope.workspace.id && s.projectId === projectId && s.id === id,
      );
      if (index === -1) return false;
      state.sources.splice(index, 1);
      return true;
    });
  },
};
