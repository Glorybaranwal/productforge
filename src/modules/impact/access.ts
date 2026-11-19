/** Shared steps for change requests (PF-053): loading, analysis, audit. */
import { runStage, type StageDeps } from "@/src/ai/orchestrator/run-stage";
import type { ImpactInput } from "@/src/ai/schemas/impact";
import { impactStage } from "@/src/ai/stages/impact.stage";
import { AppError } from "@/src/lib/errors";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import { recordAudit } from "@/src/modules/audit/service";
import { discoveryRepository } from "@/src/modules/requirements/discovery-repository";
import { sprintRepository, type PlanRows } from "@/src/modules/sprints/repository";
import { loadBacklog, type BacklogContext } from "@/src/modules/stories/state";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { findCandidates, type Candidates } from "./candidates";
import { impactRepository } from "./repository";
import { changeCode, type RequirementChange } from "./schema";

export type AnalysisResult = {
  changeId: string;
  code: string;
  run: AgentRun | null;
  replayed: boolean;
};

export async function load(ctx: WorkspaceContext, projectId: string) {
  const b = await loadBacklog(ctx, projectId);
  const ws = ctx.workspace.id;
  const [rows, plan, discovery] = await Promise.all([
    impactRepository.load(ws, projectId),
    sprintRepository.load(ws, projectId),
    discoveryRepository.get(ws, projectId),
  ]);
  return { b, rows, plan, gate1Passed: discovery?.status === "confirmed" };
}

export const candidatesFor = (
  c: Pick<RequirementChange, "kind" | "requirementCode">,
  b: BacklogContext,
  plan: PlanRows,
) => findCandidates(c, b, plan.items);

export async function audit(
  ctx: WorkspaceContext,
  c: RequirementChange,
  action: string,
  extra: Record<string, unknown> = {},
) {
  await recordAudit(ctx, {
    entityType: "project",
    entityId: c.projectId,
    action,
    diff: {
      change: { from: null, to: changeCode(c.number) },
      requirement: { from: null, to: c.requirementCode ?? "new requirement" },
      kind: { from: null, to: c.kind },
      ...extra,
    },
  });
}

export async function find(ctx: WorkspaceContext, id: string): Promise<RequirementChange> {
  const change = await impactRepository.find(ctx.workspace.id, id);
  if (!change) throw new AppError("NOT_FOUND", "Change request not found");
  return change;
}

export function requireProposed(c: RequirementChange): void {
  if (c.status !== "DRAFT")
    throw new AppError(
      "CONFLICT",
      `${changeCode(c.number)} was already ${c.status === "APPROVED" ? "approved" : "discarded"}`,
    );
}

/** Runs the impact stage on a proposal; a failed run is kept on the change so it can be retried. */
export async function analyze(
  ctx: WorkspaceContext,
  change: RequirementChange,
  b: BacklogContext,
  candidates: Candidates,
  deps: StageDeps,
): Promise<AgentRun> {
  const input: ImpactInput = {
    project: { name: b.project.name, domain: b.project.domain },
    change: {
      kind: change.kind,
      code: change.requirementCode,
      before: change.before,
      after: change.after,
      reason: change.reason,
    },
    candidates,
  };
  const run = await runStage(
    impactStage(change.id, input),
    { ctx, projectId: change.projectId },
    deps,
  );
  if (run.status === "failed")
    await impactRepository.update(ctx.workspace.id, change.id, { agentRunId: run.id });
  return run;
}

export async function result(
  ctx: WorkspaceContext,
  id: string,
  replayed: boolean,
): Promise<AnalysisResult> {
  const change = await find(ctx, id);
  const run = change.agentRunId
    ? await agentRunRepository.findById(ctx.workspace.id, change.agentRunId)
    : null;
  return { changeId: change.id, code: changeCode(change.number), run, replayed };
}
