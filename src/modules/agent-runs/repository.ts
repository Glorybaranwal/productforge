import { readState, transact } from "@/src/db/store";

import type { AgentRun, IdempotencyRecord } from "./schema";

export const agentRunRepository = {
  async insert(run: AgentRun): Promise<AgentRun> {
    return transact((state) => {
      state.agentRuns.push(run);
      return run;
    });
  },

  /** Scoped by workspace like every other write, though the id is always server-generated. */
  async update(
    workspaceId: string,
    id: string,
    patch: Partial<AgentRun>,
  ): Promise<AgentRun | null> {
    return transact((state) => {
      const run = state.agentRuns.find((r) => r.workspaceId === workspaceId && r.id === id);
      if (!run) return null;
      Object.assign(run, patch);
      return { ...run };
    });
  },

  async findById(workspaceId: string, id: string): Promise<AgentRun | null> {
    const state = await readState();
    return state.agentRuns.find((r) => r.workspaceId === workspaceId && r.id === id) ?? null;
  },

  async latestForProject(
    workspaceId: string,
    projectId: string,
    stage: AgentRun["stage"],
  ): Promise<AgentRun | null> {
    const state = await readState();
    const runs = state.agentRuns.filter(
      (r) => r.workspaceId === workspaceId && r.projectId === projectId && r.stage === stage,
    );
    return runs.at(-1) ?? null;
  },

  async findIdempotent(
    workspaceId: string,
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const state = await readState();
    return (
      state.idempotencyKeys.find(
        (k) => k.workspaceId === workspaceId && k.scope === scope && k.key === key,
      ) ?? null
    );
  },

  async saveIdempotent(record: IdempotencyRecord): Promise<void> {
    await transact((state) => {
      state.idempotencyKeys.push(record);
    });
  },
};
