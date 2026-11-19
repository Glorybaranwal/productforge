import { runStage, type StageDeps } from "@/src/ai/orchestrator/run-stage";
import { discoveryStage } from "@/src/ai/stages/discovery.stage";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError } from "@/src/lib/errors";
import { withIdempotency } from "@/src/lib/idempotency";
import { nowIso } from "@/src/lib/ids";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import { recordAudit } from "@/src/modules/audit/service";
import { getProject } from "@/src/modules/projects/service";
import { sourceRepository } from "@/src/modules/sources/repository";
import type { SourceDocument } from "@/src/modules/sources/schema";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { discoveryRepository } from "./discovery-repository";
import { questionRepository, requirementRepository } from "./repository";
import type { ClarifyingQuestion, Discovery, Requirement } from "./schema";

export type DiscoveryState = {
  sources: SourceDocument[];
  discovery: Discovery | null;
  requirements: Requirement[];
  questions: ClarifyingQuestion[];
  latestRun: AgentRun | null;
  /** Why Gate 1 can't be passed yet; empty when it can. */
  blockers: string[];
};

export type DiscoveryStatus = {
  state: "not_started" | "in_progress" | "confirmed";
  requirements: number;
  openQuestions: number;
};

function gateBlockers(
  discovery: Discovery | null,
  requirements: Requirement[],
  questions: ClarifyingQuestion[],
) {
  if (!discovery) return ["Run discovery first"];
  if (discovery.status === "confirmed") return ["Requirements are already confirmed"];
  const blockers: string[] = [];
  const open = questions.filter((q) => q.state === "open").length;
  if (open > 0)
    blockers.push(
      `Resolve ${open} open question${open === 1 ? "" : "s"} (answer, skip or mark as assumption)`,
    );
  if (!requirements.some((r) => r.status === "DRAFT"))
    blockers.push("Keep at least one requirement");
  return blockers;
}

export async function getDiscoveryState(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<DiscoveryState> {
  await getProject(ctx, projectId);
  const ws = ctx.workspace.id;
  const [sources, discovery, requirements, questions, latestRun] = await Promise.all([
    sourceRepository.listByProject(ws, projectId),
    discoveryRepository.get(ws, projectId),
    requirementRepository.listByProject(ws, projectId),
    questionRepository.listByProject(ws, projectId),
    agentRunRepository.latestForProject(ws, projectId, "discovery"),
  ]);
  return {
    sources,
    discovery,
    requirements,
    questions,
    latestRun,
    blockers: gateBlockers(discovery, requirements, questions),
  };
}

export function summarizeDiscovery(
  discovery: Discovery | null,
  requirements: Requirement[],
  questions: ClarifyingQuestion[],
): DiscoveryStatus {
  return {
    state: !discovery
      ? "not_started"
      : discovery.status === "confirmed"
        ? "confirmed"
        : "in_progress",
    requirements: requirements.filter((r) => r.status !== "REJECTED").length,
    openQuestions: questions.filter((q) => q.state === "open").length,
  };
}

export async function getDiscoveryStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<DiscoveryStatus> {
  const ws = ctx.workspace.id;
  const [discovery, requirements, questions] = await Promise.all([
    discoveryRepository.get(ws, projectId),
    requirementRepository.listByProject(ws, projectId),
    questionRepository.listByProject(ws, projectId),
  ]);
  return summarizeDiscovery(discovery, requirements, questions);
}

/** Runs (or re-runs, with the answers so far) the discovery stage. Idempotent per key. */
export async function runDiscovery(
  ctx: WorkspaceContext,
  projectId: string,
  idempotencyKey: string | null,
  deps: StageDeps = {},
): Promise<{ run: AgentRun; replayed: boolean }> {
  requireRole(ctx.role, MANAGER_ROLES, "run discovery");
  await getProject(ctx, projectId);
  const discovery = await discoveryRepository.get(ctx.workspace.id, projectId);
  if (discovery?.status === "confirmed") {
    throw new AppError("CONFLICT", "Requirements are already confirmed; discovery can't be re-run");
  }
  const { result: run, replayed } = await withIdempotency(
    ctx,
    `discovery:${projectId}`,
    idempotencyKey,
    () => runStage(discoveryStage, { ctx, projectId }, deps),
    (id) => agentRunRepository.findById(ctx.workspace.id, id),
  );
  if (!replayed) {
    await recordAudit(ctx, {
      entityType: "project",
      entityId: projectId,
      action: run.status === "succeeded" ? "discovery.run" : "discovery.failed",
      diff: { agentRunId: { from: null, to: run.id } },
    });
  }
  return { run, replayed };
}

/** Gate 1: approve all draft requirements. Blocked while questions are open. */
export async function confirmRequirements(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<DiscoveryState> {
  requireRole(ctx.role, MANAGER_ROLES, "confirm requirements");
  const state = await getDiscoveryState(ctx, projectId);
  if (state.blockers.length > 0)
    throw new AppError("CONFLICT", state.blockers.join(". "), state.blockers);
  const at = nowIso();
  const approved = await requirementRepository.approveDrafts(
    ctx.workspace.id,
    projectId,
    ctx.session.userId,
    at,
  );
  await discoveryRepository.confirm(
    { workspaceId: ctx.workspace.id, projectId },
    ctx.session.name,
    at,
  );
  await recordAudit(ctx, {
    entityType: "project",
    entityId: projectId,
    action: "requirements.confirmed",
    diff: { approved: { from: 0, to: approved } },
  });
  return getDiscoveryState(ctx, projectId);
}
