import { readState, transact } from "@/src/db/store";

import type { Sprint, SprintItem, SprintSettings } from "./schema";

export type PlanRows = { settings: SprintSettings | null; sprints: Sprint[]; items: SprintItem[] };

const mine =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

/** Sprint settings, sprints and story placements (PF-051). Scoped by workspace, mirroring RLS. */
export const sprintRepository = {
  async load(workspaceId: string, projectId: string): Promise<PlanRows> {
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

  async saveSettings(row: SprintSettings, followVelocity: { from: number } | null): Promise<void> {
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
  async replacePlan(
    workspaceId: string,
    projectId: string,
    sprints: Sprint[],
    items: SprintItem[],
  ): Promise<void> {
    await transact((state) => {
      const own = mine(workspaceId, projectId);
      state.sprints = [...state.sprints.filter((s) => !own(s)), ...sprints];
      state.sprintItems = [...state.sprintItems.filter((i) => !own(i)), ...items];
    });
  },

  /** Moves one story (pinned) into a sprint, or out of the plan when `sprint` is null. */
  async moveStory(
    workspaceId: string,
    projectId: string,
    storyCode: string,
    sprint: Sprint | null,
    create: Sprint | null,
    updatedAt: string,
  ): Promise<void> {
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

  async findSprint(workspaceId: string, id: string): Promise<Sprint | null> {
    const state = await readState();
    return state.sprints.find((s) => s.workspaceId === workspaceId && s.id === id) ?? null;
  },

  async updateSprint(
    workspaceId: string,
    id: string,
    patch: Partial<Sprint>,
  ): Promise<Sprint | null> {
    return transact((state) => {
      const row = state.sprints.find((s) => s.workspaceId === workspaceId && s.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },
};
