import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import { getProject } from "@/src/modules/projects/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { discoveryRepository } from "./discovery-repository";
import { questionRepository, requirementRepository } from "./repository";
import {
  QuestionResolution,
  RequirementCreate,
  RequirementEdit,
  type ClarifyingQuestion,
  type Requirement,
} from "./schema";

async function assertNotConfirmed(ctx: WorkspaceContext, projectId: string) {
  const discovery = await discoveryRepository.get(ctx.workspace.id, projectId);
  if (discovery?.status === "confirmed") {
    throw new AppError(
      "CONFLICT",
      "Requirements are confirmed. Approved requirements are never edited in place — versioned changes arrive with change management.",
    );
  }
}

/** Edit a draft requirement, or reject / restore it. Any workspace role may edit drafts (PRD roles). */
export async function updateRequirement(
  ctx: WorkspaceContext,
  id: string,
  input: unknown,
): Promise<Requirement> {
  const patch = parseOrThrow(RequirementEdit, input);
  const current = await requirementRepository.findById(ctx.workspace.id, id);
  if (!current) throw new AppError("NOT_FOUND", "Requirement not found");
  await assertNotConfirmed(ctx, current.projectId);
  if (current.status === "APPROVED")
    throw new AppError("CONFLICT", "Approved requirements can't be edited in place");

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
    if (value !== undefined && current[field] !== value)
      diff[field] = { from: current[field], to: value };
  }
  if (Object.keys(diff).length === 0) return current;

  const contentChanged = "text" in diff || "type" in diff || "evidence" in diff;
  const updated = await requirementRepository.update(ctx.workspace.id, id, {
    ...patch,
    origin: contentChanged && current.origin === "ai" ? "ai_edited" : current.origin,
    updatedAt: nowIso(),
  });
  if (!updated) throw new AppError("NOT_FOUND", "Requirement not found");

  const action =
    diff.status?.to === "REJECTED"
      ? "requirement.rejected"
      : diff.status?.to === "DRAFT"
        ? "requirement.restored"
        : "requirement.updated";
  await recordAudit(ctx, { entityType: "requirement", entityId: id, action, diff });
  return updated;
}

/** A requirement the PM adds by hand: origin human, evidence EXPLICIT (stated by a person). */
export async function addRequirement(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<Requirement> {
  await getProject(ctx, projectId);
  await assertNotConfirmed(ctx, projectId);
  const data = parseOrThrow(RequirementCreate, input);
  const now = nowIso();
  const requirement = await requirementRepository.insert({
    id: newId(),
    workspaceId: ctx.workspace.id,
    projectId,
    version: 1,
    text: data.text,
    type: data.type,
    evidence: "EXPLICIT",
    sourceQuote: null,
    rationale: `Added by ${ctx.session.name}`,
    sourceId: null,
    status: "DRAFT",
    origin: "human",
    agentRunId: null,
    createdAt: now,
    updatedAt: now,
    approvedBy: null,
    approvedAt: null,
  });
  await recordAudit(ctx, {
    entityType: "requirement",
    entityId: requirement.id,
    action: "requirement.added",
  });
  return requirement;
}

/** Answer, skip, mark as assumption, or re-open a clarifying question (PF-026). */
export async function resolveQuestion(
  ctx: WorkspaceContext,
  id: string,
  input: unknown,
): Promise<ClarifyingQuestion> {
  const resolution = parseOrThrow(QuestionResolution, input);
  const current = await questionRepository.findById(ctx.workspace.id, id);
  if (!current) throw new AppError("NOT_FOUND", "Question not found");
  await assertNotConfirmed(ctx, current.projectId);

  const answer =
    resolution.state === "answered" || resolution.state === "assumption" ? resolution.answer : null;
  const updated = await questionRepository.update(ctx.workspace.id, id, {
    state: resolution.state,
    answer,
    resolvedAt: resolution.state === "open" ? null : nowIso(),
  });
  if (!updated) throw new AppError("NOT_FOUND", "Question not found");
  await recordAudit(ctx, {
    entityType: "question",
    entityId: id,
    action: `question.${resolution.state === "open" ? "reopened" : resolution.state}`,
    diff: { state: { from: current.state, to: resolution.state } },
  });
  return updated;
}
