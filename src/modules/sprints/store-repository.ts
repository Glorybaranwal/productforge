import { readState, transact } from "@/src/db/store";

import type { SprintRepository } from "./repository";

const mine =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

/** Sprint settings, sprints and story placements (PF-051). Scoped by workspace, mirroring RLS. */
export const storeSprints: SprintRepository = {
  async load(scope, projectId) {
    const workspaceId = scope.workspace.id;
    const state = await readState();
    const own = mine(workspaceId, projectId);
    return {
      settings: state.sprintSettings.find(own) ?? null,
      sprints: state.sprints.filter(own).sort((a, b) => a.number - b.number),
      items: state.sprintItems
        .filter(own)
        .sort((a, b) => a.sprintNumber - b.sprintNumber || a.position - b.position),
    };
  },

  async saveSettings(_scope, row, followVelocity) {
    await transact((state) => {
      const own = mine(row.workspaceId, row.projectId);
      state.sprintSettings = [...state.sprintSettings.filter((s) => !own(s)), row];
      // Sprints still at the old velocity follow the new one; ones the PM changed keep their capacity.
      if (followVelocity) {
        for (const s of state.sprints) {
          if (own(s) && s.capacityPoints === followVelocity.from) {
            s.capacityPoints = row.velocity;
            s.updatedAt = row.updatedAt;
          }
        }
      }
    });
  },

  /** Replaces the project's sprints and placements in one write (a new plan). */
  async replacePlan(scope, projectId, sprints, items) {
    const workspaceId = scope.workspace.id;
    await transact((state) => {
      const own = mine(workspaceId, projectId);
      state.sprints = [...state.sprints.filter((s) => !own(s)), ...sprints];
      state.sprintItems = [...state.sprintItems.filter((i) => !own(i)), ...items];
    });
  },

  /** Moves one story (pinned) into a sprint, or out of the plan when `sprint` is null. */
  async moveStory(scope, projectId, storyCode, sprint, create, updatedAt) {
    const workspaceId = scope.workspace.id;
    await transact((state) => {
      const own = mine(workspaceId, projectId);
      state.sprintItems = state.sprintItems.filter((i) => !(own(i) && i.storyCode === storyCode));
      if (create) state.sprints.push(create);
      if (!sprint) return;
      const position = state.sprintItems.filter(
        (i) => own(i) && i.sprintNumber === sprint.number,
      ).length;
      state.sprintItems.push({
        workspaceId,
        projectId,
        storyCode,
        sprintNumber: sprint.number,
        position,
        pinned: true,
        reason: "Placed by hand",
        updatedAt,
      });
    });
  },

  async findSprint(scope, id) {
    const workspaceId = scope.workspace.id;
    const state = await readState();
    return state.sprints.find((s) => s.workspaceId === workspaceId && s.id === id) ?? null;
  },

  async updateSprint(scope, id, patch) {
    const workspaceId = scope.workspace.id;
    return transact((state) => {
      const row = state.sprints.find((s) => s.workspaceId === workspaceId && s.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },
};
