import { readState, transact } from "@/src/db/store";
import { AppError } from "@/src/lib/errors";

import type { AgentRunRepository } from "./repository";
import { type AgentRun, STALE_RUN_MINUTES } from "./schema";

export const ALREADY_RUNNING =
  "This step is already running for this project. Try again when it finishes.";

const isStale = (run: AgentRun, now: number) =>
  now - Date.parse(run.createdAt) > STALE_RUN_MINUTES * 60_000;

/** The demo store (ADR-011): same rules as Postgres, in one process. */
export const storeAgentRuns: AgentRunRepository = {
  async insert(scope, run) {
    return transact((state) => {
      const now = Date.now();
      for (const other of state.agentRuns) {
        if (
          other.projectId !== run.projectId ||
          other.stage !== run.stage ||
          other.status !== "running"
        )
          continue;
        if (!isStale(other, now)) throw new AppError("CONFLICT", ALREADY_RUNNING);
        Object.assign(other, {
          status: "failed",
          error: "Abandoned: the run stopped without finishing",
          finishedAt: new Date(now).toISOString(),
        });
      }
      const row = { ...run, workspaceId: scope.workspace.id };
      state.agentRuns.push(row);
      return { ...row };
    });
  },

  async update(scope, id, patch) {
    return transact((state) => {
      const run = state.agentRuns.find((r) => r.workspaceId === scope.workspace.id && r.id === id);
      if (!run || run.status !== "running") return null;
      const { id: _id, workspaceId: _ws, projectId: _p, ...rest } = patch;
      Object.assign(run, rest);
      return { ...run };
    });
  },

  async findById(scope, id) {
    const state = await readState();
    return state.agentRuns.find((r) => r.workspaceId === scope.workspace.id && r.id === id) ?? null;
  },

  async usage(scope, { userSince, workspaceSince }) {
    const state = await readState();
    const mine = state.agentRuns.filter((r) => r.workspaceId === scope.workspace.id);
    return {
      userRuns: mine.filter((r) => r.createdBy === scope.session.userId && r.createdAt >= userSince)
        .length,
      workspaceTokens: mine
        .filter((r) => r.createdAt >= workspaceSince)
        .reduce((sum, r) => sum + r.tokensIn + r.tokensOut, 0),
    };
  },

  async latestForProject(scope, projectId, stage) {
    const state = await readState();
    const runs = state.agentRuns.filter(
      (r) => r.workspaceId === scope.workspace.id && r.projectId === projectId && r.stage === stage,
    );
    return runs.at(-1) ?? null;
  },

  async findIdempotent(scope, operation, key) {
    const state = await readState();
    return (
      state.idempotencyKeys.find(
        (k) => k.workspaceId === scope.workspace.id && k.scope === operation && k.key === key,
      ) ?? null
    );
  },

  async saveIdempotent(scope, record) {
    await transact((state) => {
      const exists = state.idempotencyKeys.some(
        (k) =>
          k.workspaceId === scope.workspace.id && k.scope === record.scope && k.key === record.key,
      );
      if (!exists) state.idempotencyKeys.push({ ...record, workspaceId: scope.workspace.id });
    });
  },
};
