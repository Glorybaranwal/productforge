/** Deciding on a change request and reviewing what it flagged (PF-053). */
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { requirementRepository } from "@/src/modules/requirements/repository";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import {
  audit,
  candidatesFor,
  find,
  load,
  requireProposed,
  result,
  type AnalysisResult,
} from "./access";
import { affectedOf } from "./candidates";
import { reviewStates } from "./flags";
import { impactRepository } from "./repository";
import { changeCode, ReviewInput } from "./schema";

/** Puts the change in force: the requirement's next version; affected items become "Needs review". */
export async function approveChange(
  ctx: WorkspaceContext,
  changeId: string,
): Promise<AnalysisResult> {
  requireRole(ctx.role, MANAGER_ROLES, "approve requirement changes");
  const change = await find(ctx, changeId);
  requireProposed(change);
  const cr = changeCode(change.number);
  const { b, plan } = await load(ctx, change.projectId);
  if (change.kind !== "add") {
    const r = (await requirementRepository.listByProject(ctx.workspace.id, change.projectId)).find(
      (x) => x.code === change.requirementCode,
    );
    if (!r || r.version !== change.fromVersion || r.status !== "APPROVED")
      throw new AppError(
        "CONFLICT",
        `${change.requirementCode} changed after ${cr} was proposed — discard it and propose again`,
      );
  }
  const now = nowIso();
  const snapshot = (change.after ?? change.before)!;
  const withdraw = change.kind === "withdraw";
  const version = await requirementRepository.insertVersion({
    id: newId(),
    workspaceId: ctx.workspace.id,
    projectId: change.projectId,
    code: change.requirementCode,
    version: (change.fromVersion ?? 0) + 1,
    ...snapshot,
    sourceQuote: null,
    rationale: `${withdraw ? "Withdrawn" : change.kind === "add" ? "Added" : "Changed"} in ${cr}: ${change.reason}`,
    sourceId: null,
    status: withdraw ? "REJECTED" : "APPROVED",
    origin: "human",
    agentRunId: null,
    createdAt: now,
    updatedAt: now,
    approvedBy: withdraw ? null : ctx.session.name,
    approvedAt: withdraw ? null : now,
  });
  const affected = affectedOf(
    candidatesFor({ kind: change.kind, requirementCode: version.code }, b, plan),
  );
  const approved = await impactRepository.update(ctx.workspace.id, change.id, {
    status: "APPROVED",
    requirementCode: version.code,
    toVersion: version.version,
    affected: change.kind === "add" ? { prd: affected.prd, stories: [] } : affected,
    decidedBy: ctx.session.name,
    decidedAt: now,
  });
  if (!approved) throw new AppError("CONFLICT", `${cr} can no longer be approved`);
  await audit(ctx, approved, "change.approved", {
    version: { from: change.fromVersion, to: version.version },
    flagged: { from: null, to: approved.affected.stories.length + (approved.affected.prd ? 1 : 0) },
  });
  return result(ctx, change.id, false);
}

export async function discardChange(
  ctx: WorkspaceContext,
  changeId: string,
): Promise<AnalysisResult> {
  requireRole(ctx.role, MANAGER_ROLES, "discard requirement changes");
  const change = await find(ctx, changeId);
  requireProposed(change);
  const at = nowIso();
  const done = await impactRepository.update(ctx.workspace.id, change.id, {
    status: "REJECTED",
    decidedBy: ctx.session.name,
    decidedAt: at,
  });
  if (!done)
    throw new AppError("CONFLICT", `${changeCode(change.number)} can no longer be discarded`);
  await audit(ctx, done, "change.discarded");
  return result(ctx, change.id, false);
}

/** "Reviewed — no change needed" for one flagged story or the PRD. */
export async function markReviewed(
  ctx: WorkspaceContext,
  changeId: string,
  input: unknown,
): Promise<AnalysisResult> {
  requireRole(ctx.role, MANAGER_ROLES, "mark items reviewed");
  const { ref, note } = parseOrThrow(ReviewInput, input);
  const change = await find(ctx, changeId);
  const cr = changeCode(change.number);
  if (change.status !== "APPROVED")
    throw new AppError("CONFLICT", `${cr} isn't approved, so nothing needs review`);
  const { b, rows } = await load(ctx, change.projectId);
  const state = reviewStates(change, rows.reviews, b.current, b.prd).find((s) => s.ref === ref);
  if (!state) throw new AppError("NOT_FOUND", `${cr} didn't flag ${ref}`);
  if (state.state !== "pending")
    throw new AppError("CONFLICT", `${ref} doesn't need review for ${cr} any more`);
  await impactRepository.addReview({
    workspaceId: ctx.workspace.id,
    projectId: change.projectId,
    changeId: change.id,
    ref,
    note,
    reviewedBy: ctx.session.name,
    reviewedAt: nowIso(),
  });
  await audit(ctx, change, "change.reviewed", {
    item: { from: null, to: ref },
    note: { from: null, to: note || null },
  });
  return result(ctx, change.id, false);
}
