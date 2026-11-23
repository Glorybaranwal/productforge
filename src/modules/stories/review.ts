/** Gate 3 actions on stories (PF-042): approve, approve all ready, reject, restore, version. */
import { MANAGER_ROLES, refuseApiKeyApproval, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { audit, current, edited, refreshEpics, requireDraft } from "./access";
import { backlogRepository } from "./repository";
import { StoryRejection, type Story } from "./schema";
import { loadBacklog, requireGate2, storyChecks } from "./state";

/** Gate 3, one story at a time: freezes the story with its criteria and tasks. */
export async function approveStory(ctx: WorkspaceContext, storyId: string): Promise<Story> {
  refuseApiKeyApproval(ctx);
  requireRole(ctx.role, MANAGER_ROLES, "approve stories");
  const { story, b } = await current(ctx, storyId);
  requireDraft(story);
  const { blockers } = storyChecks(
    story,
    b,
    b.rows.criteria.filter((c) => c.storyId === storyId),
    b.rows.tasks.filter((t) => t.storyId === storyId),
  );
  if (blockers.length) throw new AppError("CONFLICT", blockers.join(". "), blockers);
  const at = nowIso();
  const approved = await backlogRepository.setStatus(ctx, storyId, ["DRAFT"], {
    status: "APPROVED",
    approvedBy: ctx.session.name,
    approvedAt: at,
    updatedAt: at,
  });
  if (!approved) throw new AppError("CONFLICT", "This story can no longer be approved");
  await audit(ctx, story, "story.approved");
  await refreshEpics(ctx, story.projectId);
  return approved;
}

/** Approves every draft story that has no blockers. */
export async function approveReadyStories(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<{ approved: string[]; skipped: number }> {
  refuseApiKeyApproval(ctx);
  requireRole(ctx.role, MANAGER_ROLES, "approve stories");
  const b = await loadBacklog(ctx, projectId);
  requireGate2(b);
  const drafts = b.current.filter((s) => s.status === "DRAFT");
  const ready = drafts.filter(
    (s) =>
      storyChecks(
        s,
        b,
        b.rows.criteria.filter((c) => c.storyId === s.id),
        b.rows.tasks.filter((t) => t.storyId === s.id),
      ).blockers.length === 0,
  );
  const at = nowIso();
  const approved: string[] = [];
  for (const s of ready) {
    const done = await backlogRepository.setStatus(ctx, s.id, ["DRAFT"], {
      status: "APPROVED",
      approvedBy: ctx.session.name,
      approvedAt: at,
      updatedAt: at,
    });
    if (done) approved.push(s.code);
  }
  if (approved.length) {
    await recordAudit(ctx, {
      entityType: "project",
      entityId: projectId,
      action: "backlog.bulk_approved",
      diff: { stories: { from: null, to: approved.join(", ") } },
    });
    await refreshEpics(ctx, projectId);
  }
  return { approved, skipped: drafts.length - approved.length };
}

export async function rejectStory(
  ctx: WorkspaceContext,
  storyId: string,
  input: unknown,
): Promise<Story> {
  requireRole(ctx.role, MANAGER_ROLES, "reject stories");
  const { reason } = parseOrThrow(StoryRejection, input);
  const { story } = await current(ctx, storyId);
  requireDraft(story);
  const rejected = await backlogRepository.setStatus(ctx, storyId, ["DRAFT"], {
    status: "REJECTED",
    rejectionReason: reason,
    updatedAt: nowIso(),
  });
  if (!rejected) throw new AppError("CONFLICT", "This story can no longer be rejected");
  await audit(ctx, story, "story.rejected", { reason: { from: null, to: reason } });
  await refreshEpics(ctx, story.projectId);
  return rejected;
}

export async function restoreStory(ctx: WorkspaceContext, storyId: string): Promise<Story> {
  requireRole(ctx.role, MANAGER_ROLES, "restore stories");
  const { story } = await current(ctx, storyId);
  if (story.status !== "REJECTED") throw new AppError("CONFLICT", `${story.code} isn't rejected`);
  const restored = await backlogRepository.setStatus(ctx, storyId, ["REJECTED"], {
    status: "DRAFT",
    rejectionReason: null,
    updatedAt: nowIso(),
  });
  if (!restored) throw new AppError("CONFLICT", "This story can no longer be restored");
  await audit(ctx, story, "story.restored");
  await refreshEpics(ctx, story.projectId);
  return restored;
}

/** Editing an approved story: copies it (with criteria and tasks) into version n+1 (ADR-006). */
export async function startStoryVersion(ctx: WorkspaceContext, storyId: string): Promise<Story> {
  requireRole(ctx.role, MANAGER_ROLES, "edit approved stories");
  const { story, b } = await current(ctx, storyId);
  if (story.status !== "APPROVED")
    throw new AppError(
      "CONFLICT",
      "Only an approved story needs a new version — edit the draft directly",
    );
  const now = nowIso();
  const id = newId();
  const copy: Story = {
    ...structuredClone(story),
    id,
    version: story.version + 1,
    basedOnVersion: story.version,
    status: "DRAFT",
    origin: edited(story.origin),
    createdBy: ctx.session.userId,
    createdAt: now,
    updatedAt: now,
    approvedBy: null,
    approvedAt: null,
  };
  const child = <
    T extends { id: string; storyId: string; status: string; createdAt: string; updatedAt: string },
  >(
    row: T,
  ): T => ({
    ...structuredClone(row),
    id: newId(),
    storyId: id,
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
  });
  await backlogRepository.insert(ctx, {
    stories: [copy],
    criteria: b.rows.criteria.filter((c) => c.storyId === storyId).map(child),
    tasks: b.rows.tasks.filter((t) => t.storyId === storyId).map(child),
  });
  await audit(ctx, copy, "story.version_created", {
    version: { from: story.version, to: copy.version },
  });
  await refreshEpics(ctx, story.projectId);
  return copy;
}
