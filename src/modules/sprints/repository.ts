import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgSprints } from "./pg-repository";
import type { Sprint, SprintItem, SprintSettings } from "./schema";
import { storeSprints } from "./store-repository";

export type PlanRows = { settings: SprintSettings | null; sprints: Sprint[]; items: SprintItem[] };

/** Sprint settings, sprints and story placements (PF-051, PF-074). Writes are one transaction each. */
export interface SprintRepository {
  load(scope: WorkspaceScope, projectId: string): Promise<PlanRows>;
  /** Saves settings; sprints still at the old velocity follow the new one. */
  saveSettings(
    scope: WorkspaceScope,
    row: SprintSettings,
    followVelocity: { from: number } | null,
  ): Promise<void>;
  /** Replaces the project's sprints and placements in one write (a new plan). */
  replacePlan(
    scope: WorkspaceScope,
    projectId: string,
    sprints: Sprint[],
    items: SprintItem[],
  ): Promise<void>;
  /** Moves one story (pinned) into a sprint, or out of the plan when `sprint` is null. */
  moveStory(
    scope: WorkspaceScope,
    projectId: string,
    storyCode: string,
    sprint: Sprint | null,
    create: Sprint | null,
    updatedAt: string,
  ): Promise<void>;
  findSprint(scope: WorkspaceScope, id: string): Promise<Sprint | null>;
  updateSprint(scope: WorkspaceScope, id: string, patch: Partial<Sprint>): Promise<Sprint | null>;
}

const pick = () => (dataBackend() === "postgres" ? pgSprints : storeSprints);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-030). */
export const sprintRepository: SprintRepository = {
  load: (...a) => pick().load(...a),
  saveSettings: (...a) => pick().saveSettings(...a),
  replacePlan: (...a) => pick().replacePlan(...a),
  moveStory: (...a) => pick().moveStory(...a),
  findSprint: (...a) => pick().findSprint(...a),
  updateSprint: (...a) => pick().updateSprint(...a),
};
