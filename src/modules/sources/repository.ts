import { readState, transact } from "@/src/db/store";

import type { SourceDocument } from "./schema";

export const sourceRepository = {
  async listByProject(workspaceId: string, projectId: string): Promise<SourceDocument[]> {
    const state = await readState();
    return state.sources.filter((s) => s.workspaceId === workspaceId && s.projectId === projectId);
  },

  async insert(source: SourceDocument): Promise<SourceDocument> {
    return transact((state) => {
      state.sources.push(source);
      return source;
    });
  },

  async remove(workspaceId: string, projectId: string, id: string): Promise<boolean> {
    return transact((state) => {
      const index = state.sources.findIndex(
        (s) => s.workspaceId === workspaceId && s.projectId === projectId && s.id === id,
      );
      if (index === -1) return false;
      state.sources.splice(index, 1);
      return true;
    });
  },
};
