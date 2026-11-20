/** Shared guards for the people-side story actions (edit.ts, review.ts). */
import { AppError } from "@/src/lib/errors";
import { nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { backlogRepository } from "./repository";
import type { Story } from "./schema";
import { loadBacklog, type BacklogContext } from "./state";

export const edited = (origin: Story["origin"]) => (origin === "human" ? "human" : "ai_edited");

/** The story, its project's backlog, and a guard that it's the current version. */
export async function current(
  ctx: WorkspaceContext,
  storyId: string,
): Promise<{ story: Story; b: BacklogContext }> {
  const found = await backlogRepository.findStory(ctx, storyId);
  if (!found) throw new AppError("NOT_FOUND", "Story not found");
  const b = await loadBacklog(ctx, found.projectId);
  const story = b.current.find((s) => s.id === storyId);
  if (!story)
    throw new AppError("CONFLICT", `A newer version of ${found.code} exists — open that one`);
  return { story, b };
}

export function requireDraft(story: Story): void {
  if (story.status === "APPROVED")
    throw new AppError(
      "CONFLICT",
      `${story.code} v${story.version} is approved and frozen — start a new version to edit it`,
    );
  if (story.status === "REJECTED")
    throw new AppError(
      "CONFLICT",
      `${story.code} was rejected — restore it or regenerate it first`,
    );
}

export async function audit(
  ctx: WorkspaceContext,
  story: Story,
  action: string,
  diff: Record<string, unknown> = {},
) {
  await recordAudit(ctx, {
    entityType: "project",
    entityId: story.projectId,
    action,
    diff: {
      story: { from: null, to: story.code },
      version: { from: null, to: story.version },
      ...diff,
    },
  });
}

/** Epics are approved when every live story in them is approved (they're groupings, not versioned). */
export async function refreshEpics(ctx: WorkspaceContext, projectId: string): Promise<void> {
  const b = await loadBacklog(ctx, projectId);
  for (const epic of b.rows.epics) {
    const live = b.current.filter((s) => s.epicId === epic.id && s.status !== "REJECTED");
    const status = live.length && live.every((s) => s.status === "APPROVED") ? "APPROVED" : "DRAFT";
    if (epic.status !== status)
      await backlogRepository.updateEpic(ctx, epic.id, {
        status,
        updatedAt: nowIso(),
      });
  }
}
