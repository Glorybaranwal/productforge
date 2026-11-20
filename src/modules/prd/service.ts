import { runStage, type StageDeps } from "@/src/ai/orchestrator/run-stage";
import { prdStage } from "@/src/ai/stages/prd.stage";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { withIdempotency } from "@/src/lib/idempotency";
import { newId, nowIso } from "@/src/lib/ids";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import { recordAudit } from "@/src/modules/audit/service";
import { recordExport } from "@/src/modules/exports/record";
import { pendingReviews, type ReviewFlag } from "@/src/modules/impact/flags";
import { impactRepository } from "@/src/modules/impact/repository";
import { getProject } from "@/src/modules/projects/service";
import { discoveryRepository } from "@/src/modules/requirements/discovery-repository";
import { requirementRepository } from "@/src/modules/requirements/repository";
import type { Requirement } from "@/src/modules/requirements/schema";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { prdToMarkdown } from "./markdown";
import { prdRepository } from "./repository";
import { PrdContent, PrdSectionPatch, traceabilityProblems, type Prd } from "./schema";

export type PrdState = {
  /** Gate 1 passed: the PRD can be generated. */
  gate1Passed: boolean;
  versions: Prd[];
  /** Approved requirements: what the PRD links to (with their evidence, for the chips). */
  requirements: Requirement[];
  latestRun: AgentRun | null;
  /** Why the latest version can't be approved yet; empty when it can. */
  blockers: string[];
  /** Approved requirement changes the approved PRD hasn't caught up with (PF-053). */
  review: ReviewFlag[];
};

export type PrdStatus = {
  state: "locked" | "not_started" | "draft" | "approved";
  version: number | null;
  approvedVersion: number | null;
};

/** Gate 2 checks for one version against the approved requirement codes. */
export function prdBlockers(prd: Prd | undefined, approvedCodes: string[]): string[] {
  if (!prd) return ["Generate the PRD first"];
  if (prd.status === "APPROVED")
    return [`Version ${prd.version} is approved — start a new version to change it`];
  const parsed = PrdContent.safeParse(prd.content);
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "PRD"}: ${i.message}`);
  }
  return traceabilityProblems(parsed.data, approvedCodes);
}

export function summarizePrd(gate1Passed: boolean, versions: Prd[]): PrdStatus {
  const latest = versions.at(-1);
  const approved = [...versions].reverse().find((v) => v.status === "APPROVED");
  return {
    state: !gate1Passed
      ? "locked"
      : !latest
        ? "not_started"
        : latest.status === "APPROVED"
          ? "approved"
          : "draft",
    version: latest?.version ?? null,
    approvedVersion: approved?.version ?? null,
  };
}

async function loadBasics(ctx: WorkspaceContext, projectId: string) {
  await getProject(ctx, projectId);
  const ws = ctx.workspace.id;
  const [discovery, requirements, versions, changes] = await Promise.all([
    discoveryRepository.get(ctx, projectId),
    requirementRepository.listByProject(ctx, projectId),
    prdRepository.listByProject(ws, projectId),
    impactRepository.load(ws, projectId),
  ]);
  const approvedPrd = [...versions].reverse().find((v) => v.status === "APPROVED") ?? null;
  return {
    gate1Passed: discovery?.status === "confirmed",
    approved: requirements.filter((r) => r.status === "APPROVED"),
    versions,
    review: pendingReviews(changes.changes, changes.reviews, [], approvedPrd).prd,
  };
}

export async function getPrdState(ctx: WorkspaceContext, projectId: string): Promise<PrdState> {
  const { gate1Passed, approved, versions, review } = await loadBasics(ctx, projectId);
  const latestRun = await agentRunRepository.latestForProject(ctx, projectId, "prd");
  return {
    gate1Passed,
    versions,
    requirements: approved,
    latestRun,
    blockers: gate1Passed
      ? prdBlockers(
          versions.at(-1),
          approved.map((r) => r.code),
        )
      : ["Confirm the requirements (Gate 1) first"],
    review,
  };
}

export async function getPrdStatus(ctx: WorkspaceContext, projectId: string): Promise<PrdStatus> {
  const { gate1Passed, versions } = await loadBasics(ctx, projectId);
  return summarizePrd(gate1Passed, versions);
}

async function findPrd(ctx: WorkspaceContext, id: string): Promise<Prd> {
  const prd = await prdRepository.findById(ctx.workspace.id, id);
  if (!prd) throw new AppError("NOT_FOUND", "PRD not found");
  return prd;
}

export async function getPrd(ctx: WorkspaceContext, id: string): Promise<Prd> {
  return findPrd(ctx, id);
}

/** Generates the PRD (PF-030): fills the open draft, or starts the next version after an approval. */
export async function generatePrd(
  ctx: WorkspaceContext,
  projectId: string,
  idempotencyKey: string | null,
  deps: StageDeps = {},
): Promise<{ run: AgentRun; replayed: boolean }> {
  requireRole(ctx.role, MANAGER_ROLES, "generate the PRD");
  await getProject(ctx, projectId);
  const { result: run, replayed } = await withIdempotency(
    ctx,
    `prd:${projectId}`,
    idempotencyKey,
    () => runStage(prdStage, { ctx, projectId }, deps),
    (id) => agentRunRepository.findById(ctx, id),
  );
  if (!replayed) {
    await recordAudit(ctx, {
      entityType: "project",
      entityId: projectId,
      action: run.status === "succeeded" ? "prd.generated" : "prd.failed",
      diff: { agentRunId: { from: null, to: run.id } },
    });
  }
  return { run, replayed };
}

/** Saves one section of a draft (PF-031 autosave). Approved versions are frozen (ADR-006). */
export async function updatePrdSection(
  ctx: WorkspaceContext,
  id: string,
  input: unknown,
): Promise<Prd> {
  const { section, value } = parseOrThrow(PrdSectionPatch, input);
  const current = await findPrd(ctx, id);
  if (current.status === "APPROVED") {
    throw new AppError(
      "CONFLICT",
      `Version ${current.version} is approved and frozen — start a new version to edit`,
    );
  }
  if (JSON.stringify(current.content[section]) === JSON.stringify(value)) return current;
  const updated = await prdRepository.updateDraft(ctx.workspace.id, id, {
    content: { ...current.content, [section]: value },
    origin: current.origin === "human" ? "human" : "ai_edited",
    updatedAt: nowIso(),
  });
  if (!updated) throw new AppError("CONFLICT", "This version can no longer be edited");
  await recordAudit(ctx, {
    entityType: "project",
    entityId: current.projectId,
    action: "prd.updated",
    diff: { section: { from: null, to: section }, version: { from: null, to: current.version } },
  });
  return updated;
}

/** Gate 2: approve and freeze a version. */
export async function approvePrd(ctx: WorkspaceContext, id: string): Promise<Prd> {
  requireRole(ctx.role, MANAGER_ROLES, "approve the PRD");
  const prd = await findPrd(ctx, id);
  const versions = await prdRepository.listByProject(ctx.workspace.id, prd.projectId);
  if (versions.at(-1)?.id !== prd.id)
    throw new AppError("CONFLICT", "Only the latest version can be approved");
  const approvedCodes = (await requirementRepository.listByProject(ctx, prd.projectId))
    .filter((r) => r.status === "APPROVED")
    .map((r) => r.code);
  const blockers = prdBlockers(prd, approvedCodes);
  if (blockers.length) throw new AppError("CONFLICT", blockers.join(". "), blockers);

  const at = nowIso();
  const approved = await prdRepository.updateDraft(ctx.workspace.id, id, {
    status: "APPROVED",
    approvedBy: ctx.session.name,
    approvedAt: at,
    updatedAt: at,
  });
  if (!approved) throw new AppError("CONFLICT", "This version can no longer be approved");
  await recordAudit(ctx, {
    entityType: "project",
    entityId: prd.projectId,
    action: "prd.approved",
    diff: { version: { from: null, to: prd.version } },
  });
  return approved;
}

/** Editing after approval: copy the approved version into version n+1 (the approved one stays intact). */
export async function startNewVersion(ctx: WorkspaceContext, id: string): Promise<Prd> {
  const prd = await findPrd(ctx, id);
  const versions = await prdRepository.listByProject(ctx.workspace.id, prd.projectId);
  const latest = versions.at(-1)!;
  if (latest.status === "DRAFT") return latest; // a draft is already open: keep working on it
  if (prd.status !== "APPROVED")
    throw new AppError("CONFLICT", "Only an approved version can be copied");
  const now = nowIso();
  const draft = await prdRepository.insertVersion({
    id: newId(),
    workspaceId: ctx.workspace.id,
    projectId: prd.projectId,
    content: structuredClone(latest.content),
    status: "DRAFT",
    origin: latest.origin === "human" ? "human" : "ai_edited",
    agentRunId: latest.agentRunId,
    basedOnVersion: latest.version,
    createdBy: ctx.session.userId,
    createdAt: now,
    updatedAt: now,
    approvedBy: null,
    approvedAt: null,
  });
  await recordAudit(ctx, {
    entityType: "project",
    entityId: prd.projectId,
    action: "prd.version_created",
    diff: { version: { from: latest.version, to: draft.version } },
  });
  return draft;
}

export async function getPrdMarkdown(
  ctx: WorkspaceContext,
  id: string,
): Promise<{ markdown: string; filename: string }> {
  const prd = await findPrd(ctx, id);
  const project = await getProject(ctx, prd.projectId);
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "prd";
  await recordExport(ctx, prd.projectId, "prd", { format: "markdown", version: prd.version });
  return { markdown: prdToMarkdown(project.name, prd), filename: `${slug}-prd-v${prd.version}.md` };
}
