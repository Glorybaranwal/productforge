import { readState, transact } from "@/src/db/store";

import type { WorkspaceRepository } from "./repository";

/** Demo store (ADR-011). */
export const storeWorkspaces: WorkspaceRepository = {
  async findById(_scope, id) {
    const state = await readState();
    return state.workspaces.find((w) => w.id === id) ?? null;
  },

  async membershipsForUser(_scope, userId) {
    const state = await readState();
    return state.workspaceMembers.filter((m) => m.userId === userId);
  },

  // One transaction, so two first requests can't create two workspaces.
  async ensureDefault(_scope, userId, make) {
    return transact((state) => {
      const member = state.workspaceMembers.find((m) => m.userId === userId);
      const workspace = member && state.workspaces.find((w) => w.id === member.workspaceId);
      if (member && workspace) return { workspace, member, created: false };

      const fresh = make();
      state.workspaces.push(fresh.workspace);
      state.workspaceMembers.push(fresh.member);
      return { ...fresh, created: true };
    });
  },
};
