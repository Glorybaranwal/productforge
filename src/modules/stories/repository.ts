import type { DbState } from "@/src/db/state";
import { readState, transact } from "@/src/db/store";

import type { AcceptanceCriterion, Epic, Story, TechnicalTask } from "./schema";

export type BacklogRows = {
  epics: Epic[];
  /** Every version of every story. */
  stories: Story[];
  criteria: AcceptanceCriterion[];
  tasks: TechnicalTask[];
};

type Status = Story["status"];

const inProject =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

function select(state: DbState, workspaceId: string, projectId: string): BacklogRows {
  const mine = inProject(workspaceId, projectId);
  return {
    epics: state.epics.filter(mine).sort((a, b) => a.code.localeCompare(b.code)),
    stories: state.stories.filter(mine),
    criteria: state.criteria.filter(mine).sort(byPosition),
    tasks: state.tasks.filter(mine).sort(byPosition),
  };
}

/**
 * Epics, stories, acceptance criteria and technical tasks (PF-033). Every query is scoped by
 * workspace, mirroring RLS. Approved stories and their children are never changed: the update
 * methods take the statuses they may act on and return null otherwise (ADR-006).
 */
export const backlogRepository = {
  async load(workspaceId: string, projectId: string): Promise<BacklogRows> {
    return select(await readState(), workspaceId, projectId);
  },

  async findStory(workspaceId: string, id: string): Promise<Story | null> {
    const state = await readState();
    return state.stories.find((s) => s.workspaceId === workspaceId && s.id === id) ?? null;
  },

  async insert(rows: Partial<BacklogRows>): Promise<void> {
    await transact((state) => {
      state.epics.push(...(rows.epics ?? []));
      state.stories.push(...(rows.stories ?? []));
      state.criteria.push(...(rows.criteria ?? []));
      state.tasks.push(...(rows.tasks ?? []));
    });
  },

  /** Updates a story whose status is in `allowed`; null if missing or not allowed. */
  async updateStory(
    workspaceId: string,
    id: string,
    allowed: Status[],
    patch: Partial<Story>,
  ): Promise<Story | null> {
    return transact((state) => {
      const row = state.stories.find((s) => s.workspaceId === workspaceId && s.id === id);
      if (!row || !allowed.includes(row.status)) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },

  /**
   * Replaces a draft story's criteria and/or tasks in one write. Returns false (and changes
   * nothing) unless the story is a DRAFT.
   */
  async replaceChildren(
    workspaceId: string,
    storyId: string,
    children: { criteria?: AcceptanceCriterion[]; tasks?: TechnicalTask[] },
    storyPatch: Partial<Story> = {},
  ): Promise<boolean> {
    return transact((state) => {
      const story = state.stories.find((s) => s.workspaceId === workspaceId && s.id === storyId);
      if (!story || story.status !== "DRAFT") return false;
      if (children.criteria) {
        state.criteria = state.criteria.filter((c) => c.storyId !== storyId);
        state.criteria.push(...children.criteria);
      }
      if (children.tasks) {
        state.tasks = state.tasks.filter((t) => t.storyId !== storyId);
        state.tasks.push(...children.tasks);
      }
      Object.assign(story, storyPatch);
      return true;
    });
  },

  /**
   * Moves a story and its criteria and tasks to a new status together (approve, reject,
   * restore). Only acts when the story's current status is in `from`.
   */
  async setStatus(
    workspaceId: string,
    storyId: string,
    from: Status[],
    patch: Partial<Story> & { status: Status },
  ): Promise<Story | null> {
    return transact((state) => {
      const story = state.stories.find((s) => s.workspaceId === workspaceId && s.id === storyId);
      if (!story || !from.includes(story.status)) return null;
      Object.assign(story, patch);
      for (const row of [...state.criteria, ...state.tasks]) {
        if (row.storyId === storyId) {
          row.status = patch.status;
          row.updatedAt = patch.updatedAt ?? row.updatedAt;
        }
      }
      return { ...story };
    });
  },

  /** Rewrites a story (regenerate) and removes its criteria and tasks, in one write. */
  async resetStory(
    workspaceId: string,
    id: string,
    allowed: Status[],
    patch: Partial<Story>,
  ): Promise<Story | null> {
    return transact((state) => {
      const row = state.stories.find((s) => s.workspaceId === workspaceId && s.id === id);
      if (!row || !allowed.includes(row.status)) return null;
      Object.assign(row, patch);
      state.criteria = state.criteria.filter((c) => c.storyId !== id);
      state.tasks = state.tasks.filter((t) => t.storyId !== id);
      return { ...row };
    });
  },

  async updateEpic(workspaceId: string, id: string, patch: Partial<Epic>): Promise<void> {
    await transact((state) => {
      const epic = state.epics.find((e) => e.workspaceId === workspaceId && e.id === id);
      if (epic) Object.assign(epic, patch);
    });
  },
};
