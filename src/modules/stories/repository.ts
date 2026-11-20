import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgBacklog } from "./pg-repository";
import type { AcceptanceCriterion, Epic, Story, TechnicalTask } from "./schema";
import { storeBacklog } from "./store-repository";

export type BacklogRows = {
  epics: Epic[];
  /** Every version of every story. */
  stories: Story[];
  criteria: AcceptanceCriterion[];
  tasks: TechnicalTask[];
};

type Status = Story["status"];

/**
 * Epics, stories, acceptance criteria and technical tasks (PF-033, PF-073). Approved stories and
 * their children are never changed: the update methods take the statuses they may act on and
 * return null otherwise (ADR-006, ADR-029).
 */
export interface BacklogRepository {
  load(scope: WorkspaceScope, projectId: string): Promise<BacklogRows>;
  findStory(scope: WorkspaceScope, id: string): Promise<Story | null>;
  /** Inserts rows of any kind together (all or nothing). */
  insert(scope: WorkspaceScope, rows: Partial<BacklogRows>): Promise<void>;
  /** Updates a story whose status is in `allowed`; null if missing or not allowed. */
  updateStory(
    scope: WorkspaceScope,
    id: string,
    allowed: Status[],
    patch: Partial<Story>,
  ): Promise<Story | null>;
  /** Replaces a DRAFT story's criteria and/or tasks in one write; false (no change) otherwise. */
  replaceChildren(
    scope: WorkspaceScope,
    storyId: string,
    children: { criteria?: AcceptanceCriterion[]; tasks?: TechnicalTask[] },
    storyPatch?: Partial<Story>,
  ): Promise<boolean>;
  /** Moves a story and its criteria and tasks to a new status together, if it's in `from`. */
  setStatus(
    scope: WorkspaceScope,
    storyId: string,
    from: Status[],
    patch: Partial<Story> & { status: Status },
  ): Promise<Story | null>;
  /** Rewrites a story (regenerate) and removes its criteria and tasks, in one write. */
  resetStory(
    scope: WorkspaceScope,
    id: string,
    allowed: Status[],
    patch: Partial<Story>,
  ): Promise<Story | null>;
  updateEpic(scope: WorkspaceScope, id: string, patch: Partial<Epic>): Promise<void>;
}

const postgres = () => dataBackend() === "postgres";
const pick = () => (postgres() ? pgBacklog : storeBacklog);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-029). */
export const backlogRepository: BacklogRepository = {
  load: (...a) => pick().load(...a),
  findStory: (...a) => pick().findStory(...a),
  insert: (...a) => pick().insert(...a),
  updateStory: (...a) => pick().updateStory(...a),
  replaceChildren: (...a) => pick().replaceChildren(...a),
  setStatus: (...a) => pick().setStatus(...a),
  resetStory: (...a) => pick().resetStory(...a),
  updateEpic: (...a) => pick().updateEpic(...a),
};
