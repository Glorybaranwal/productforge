import { readState, transact } from "@/src/db/store";

import type { ProjectRepository } from "./repository";

/** Demo store (ADR-011). Every query is scoped by workspaceId, the rule RLS enforces in Postgres. */
export const storeProjects: ProjectRepository = {
  async listByWorkspace(_scope, workspaceId) {
    const state = await readState();
    // Newest insert first, then a stable sort by last update, so same-millisecond ties stay predictable.
    return state.projects
      .filter((p) => p.workspaceId === workspaceId)
      .reverse()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async findById(_scope, workspaceId, id) {
    const state = await readState();
    return state.projects.find((p) => p.workspaceId === workspaceId && p.id === id) ?? null;
  },

  async insert(_scope, project) {
    return transact((state) => {
      state.projects.push(project);
      return project;
    });
  },

  async update(_scope, workspaceId, id, patch, updatedAt) {
    return transact((state) => {
      const project = state.projects.find((p) => p.workspaceId === workspaceId && p.id === id);
      if (!project) return null;
      Object.assign(project, patch, { updatedAt });
      return { ...project };
    });
  },

  async remove(_scope, workspaceId, id) {
    return transact((state) => {
      const index = state.projects.findIndex((p) => p.workspaceId === workspaceId && p.id === id);
      if (index === -1) return false;
      state.projects.splice(index, 1);
      return true;
    });
  },
};
