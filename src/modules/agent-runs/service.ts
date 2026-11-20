import { AppError } from "@/src/lib/errors";
import { getProject } from "@/src/modules/projects/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { agentRunRepository } from "./repository";
import { type AgentRun, STAGES, type StageName } from "./schema";

/** One run of the user's workspace; NOT_FOUND for others' and unknown ids. */
export async function getRun(ctx: WorkspaceContext, id: string): Promise<AgentRun> {
  const run = await agentRunRepository.findById(ctx, id);
  if (!run) throw new AppError("NOT_FOUND", "Run not found");
  return run;
}

/** Parses `?stages=a,b` for the live view; VALIDATION_ERROR for anything else. */
export function parseStages(value: string | null): StageName[] {
  const stages = (value ?? "").split(",");
  if (!stages.every((s): s is StageName => (STAGES as readonly string[]).includes(s)))
    throw new AppError("VALIDATION_ERROR", `stages must be some of: ${STAGES.join(", ")}`);
  return stages;
}

/**
 * The newest run of each stage, for the live view (PF-027). Checks the project first, so another
 * workspace's project answers NOT_FOUND.
 */
export async function runWatcher(ctx: WorkspaceContext, projectId: string, stages: StageName[]) {
  await getProject(ctx, projectId);
  return () =>
    Promise.all(stages.map((s) => agentRunRepository.latestForProject(ctx, projectId, s)));
}
