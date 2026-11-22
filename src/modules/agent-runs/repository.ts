import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgAgentRuns } from "./pg-repository";
import type { AgentRun, IdempotencyRecord, RunUsage, StageName, UsageWindow } from "./schema";
import { storeAgentRuns } from "./store-repository";

/** The AI run log (CLAUDE.md §7) and idempotency records (§8), per workspace. */
export interface AgentRunRepository {
  /**
   * Logs a run that is starting. Refused with CONFLICT while another run of the same stage is
   * running for the project (ADR-027); a run abandoned for `STALE_RUN_MINUTES` is marked failed first.
   */
  insert(scope: WorkspaceScope, run: AgentRun): Promise<AgentRun>;
  /** Finishes a running run. Finished runs never change: null for those, and for unknown ids. */
  update(scope: WorkspaceScope, id: string, patch: Partial<AgentRun>): Promise<AgentRun | null>;
  findById(scope: WorkspaceScope, id: string): Promise<AgentRun | null>;
  latestForProject(
    scope: WorkspaceScope,
    projectId: string,
    stage: StageName,
  ): Promise<AgentRun | null>;
  /** What the AI budget checks need (gap 1 of the test plan, ADR-035). */
  usage(scope: WorkspaceScope, window: UsageWindow): Promise<RunUsage>;
  findIdempotent(
    scope: WorkspaceScope,
    operation: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  /** Keeps the first record when two requests with the same key finish together. */
  saveIdempotent(scope: WorkspaceScope, record: IdempotencyRecord): Promise<void>;
}

const postgres = () => dataBackend() === "postgres";

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-027). */
export const agentRunRepository: AgentRunRepository = {
  insert: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).insert(...a),
  update: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).update(...a),
  findById: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).findById(...a),
  usage: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).usage(...a),
  latestForProject: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).latestForProject(...a),
  findIdempotent: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).findIdempotent(...a),
  saveIdempotent: (...a) => (postgres() ? pgAgentRuns : storeAgentRuns).saveIdempotent(...a),
};
