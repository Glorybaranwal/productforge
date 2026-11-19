import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import { loadBacklog, type BacklogContext } from "@/src/modules/stories/state";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { buildBoard, planStories, type SprintBoard } from "./board";
import { autoGoal } from "./goals";
import { planSprints } from "./planner";
import { sprintRepository, type PlanRows } from "./repository";
import {
  nextMonday,
  PlanRequest,
  SprintMove,
  SprintSettingsInput,
  SprintUpdate,
  suggestedVelocity,
  type Sprint,
  type SprintItem,
  type SprintSettings,
} from "./schema";

export type SprintStatus = {
  state: "locked" | "ready" | "planned";
  sprints: number;
  points: number;
  end: string | null;
  warnings: number;
};

async function load(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<{ b: BacklogContext; rows: PlanRows }> {
  const b = await loadBacklog(ctx, projectId);
  return { b, rows: await sprintRepository.load(ctx.workspace.id, projectId) };
}

async function audit(
  ctx: WorkspaceContext,
  projectId: string,
  action: string,
  diff: Record<string, unknown>,
) {
  await recordAudit(ctx, { entityType: "project", entityId: projectId, action, diff });
}

/** Re-writes the goals the planner owns (autoGoal) after stories move. */
async function refreshAutoGoals(ctx: WorkspaceContext, projectId: string): Promise<SprintBoard> {
  const { b, rows } = await load(ctx, projectId);
  const board = buildBoard(b, rows, b.project);
  for (const sp of board.sprints) {
    const goal = autoGoal(sp.stories);
    if (sp.autoGoal && sp.goal !== goal) {
      await sprintRepository.updateSprint(ctx.workspace.id, sp.id, { goal, updatedAt: nowIso() });
      sp.goal = goal;
    }
  }
  return board;
}

/** Planning or placing the first story by hand saves the suggested settings the board showed. */
async function ensureSettings(
  ctx: WorkspaceContext,
  b: BacklogContext,
  rows: PlanRows,
): Promise<SprintSettings> {
  if (rows.settings) return rows.settings;
  const now = nowIso();
  const settings: SprintSettings = {
    workspaceId: ctx.workspace.id,
    projectId: b.project.id,
    velocity: suggestedVelocity(b.project.teamSize, b.project.sprintLengthDays),
    startDate: nextMonday(now.slice(0, 10)),
    updatedAt: now,
  };
  await sprintRepository.saveSettings(settings, null);
  return settings;
}

export async function getSprintBoard(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<SprintBoard> {
  const { b, rows } = await load(ctx, projectId);
  return buildBoard(b, rows, b.project);
}

export function summarizeSprints(board: SprintBoard): SprintStatus {
  return {
    state: !board.ready ? "locked" : board.forecast.sprints ? "planned" : "ready",
    sprints: board.forecast.sprints,
    points: board.forecast.points,
    end: board.forecast.end,
    warnings: board.warnings.length,
  };
}

export async function getSprintStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<SprintStatus> {
  return summarizeSprints(await getSprintBoard(ctx, projectId));
}

/** Velocity and the first sprint's start date (PF-051). */
export async function saveSprintSettings(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<SprintBoard> {
  requireRole(ctx.role, MANAGER_ROLES, "change sprint settings");
  const value = parseOrThrow(SprintSettingsInput, input);
  const { rows } = await load(ctx, projectId);
  const before = rows.settings;
  const row: SprintSettings = {
    workspaceId: ctx.workspace.id,
    projectId,
    velocity: value.velocity,
    startDate: value.startDate,
    updatedAt: nowIso(),
  };
  const changedVelocity =
    before && before.velocity !== row.velocity ? { from: before.velocity } : null;
  await sprintRepository.saveSettings(row, changedVelocity);
  await audit(ctx, projectId, "sprints.settings_updated", {
    velocity: { from: before?.velocity ?? null, to: row.velocity },
    startDate: { from: before?.startDate ?? null, to: row.startDate },
  });
  return getSprintBoard(ctx, projectId);
}

/** Automatic plan (PF-052): dependencies first, never over capacity, Must → Should → Could. */
export async function planProjectSprints(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<SprintBoard> {
  requireRole(ctx.role, MANAGER_ROLES, "plan sprints");
  const { keepPinned } = parseOrThrow(PlanRequest, input ?? {});
  const { b, rows } = await load(ctx, projectId);
  const { plannable, unplannable } = planStories(b);
  if (!plannable.length) {
    throw new AppError("CONFLICT", "Approve at least one story before planning sprints");
  }
  const now = nowIso();
  const { velocity } = await ensureSettings(ctx, b, rows);
  const existing = new Map(rows.sprints.map((s) => [s.number, s]));
  const codes = new Set(plannable.map((s) => s.code));
  const pinned = new Map(
    keepPinned
      ? rows.items
          .filter((i) => i.pinned && codes.has(i.storyCode))
          .map((i) => [i.storyCode, i.sprintNumber])
      : [],
  );
  const result = planSprints(plannable, {
    capacity: (n) => existing.get(n)?.capacityPoints ?? velocity,
    pinned,
    unplannable,
  });

  // Sprints 1..last used; a later sprint the PM customised (goal or capacity) is kept too.
  const customised = rows.sprints
    .filter((s) => !s.autoGoal || s.capacityPoints !== velocity)
    .map((s) => s.number);
  const last = Math.max(0, ...result.placements.map((p) => p.sprint), ...customised);
  const items: SprintItem[] = [];
  const position = new Map<number, number>();
  for (const p of result.placements) {
    const at = position.get(p.sprint) ?? 0;
    position.set(p.sprint, at + 1);
    items.push({
      workspaceId: ctx.workspace.id,
      projectId,
      storyCode: p.code,
      sprintNumber: p.sprint,
      position: at,
      pinned: pinned.has(p.code),
      reason: p.reason,
      updatedAt: now,
    });
  }
  const sprints: Sprint[] = Array.from({ length: last }, (_, i) => {
    const old = existing.get(i + 1);
    return old
      ? { ...old, updatedAt: now }
      : {
          id: newId(),
          workspaceId: ctx.workspace.id,
          projectId,
          number: i + 1,
          goal: "",
          autoGoal: true,
          capacityPoints: velocity,
          createdAt: now,
          updatedAt: now,
        };
  });
  await sprintRepository.replacePlan(ctx.workspace.id, projectId, sprints, items);
  await audit(ctx, projectId, "sprints.planned", {
    sprints: {
      from: rows.sprints.length || null,
      to: Math.max(0, ...result.placements.map((p) => p.sprint)),
    },
    stories: { from: null, to: items.length },
    unplanned: { from: null, to: result.unplanned.length },
    keptByHand: { from: null, to: pinned.size },
  });
  return refreshAutoGoals(ctx, projectId);
}

/** Drag-and-drop / "Move to" (PF-052). The move is pinned; the board flags any problem it causes. */
export async function moveStoryToSprint(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<SprintBoard> {
  requireRole(ctx.role, MANAGER_ROLES, "move stories between sprints");
  const move = parseOrThrow(SprintMove, input);
  const { b, rows } = await load(ctx, projectId);
  const story = b.current.find((s) => s.code === move.storyCode);
  if (!story) throw new AppError("NOT_FOUND", `${move.storyCode} isn't in this backlog`);
  const from = rows.items.find((i) => i.storyCode === story.code)?.sprintNumber ?? null;
  if (move.sprintNumber === from) return getSprintBoard(ctx, projectId);
  let target: Sprint | null = null;
  let create: Sprint | null = null;
  if (move.sprintNumber !== null) {
    if (story.status !== "APPROVED") {
      throw new AppError(
        "CONFLICT",
        `Only approved stories go in a sprint — approve ${story.code} first`,
      );
    }
    const last = rows.sprints.at(-1)?.number ?? 0;
    target = rows.sprints.find((s) => s.number === move.sprintNumber) ?? null;
    if (!target && move.sprintNumber === last + 1) {
      const now = nowIso();
      create = {
        id: newId(),
        workspaceId: ctx.workspace.id,
        projectId,
        number: last + 1,
        goal: "",
        autoGoal: true,
        capacityPoints: (await ensureSettings(ctx, b, rows)).velocity,
        createdAt: now,
        updatedAt: now,
      };
      target = create;
    }
    if (!target) throw new AppError("VALIDATION_ERROR", `There's no sprint ${move.sprintNumber}`);
  }
  await sprintRepository.moveStory(
    ctx.workspace.id,
    projectId,
    story.code,
    target,
    create,
    nowIso(),
  );
  await audit(ctx, projectId, "sprint.story_moved", {
    story: { from: null, to: story.code },
    sprint: { from, to: move.sprintNumber },
  });
  return refreshAutoGoals(ctx, projectId);
}

/** Sprint goal and capacity (lower it for holidays). Clearing the goal hands it back to the planner. */
export async function updateSprint(
  ctx: WorkspaceContext,
  sprintId: string,
  input: unknown,
): Promise<SprintBoard> {
  requireRole(ctx.role, MANAGER_ROLES, "edit sprints");
  const patch = parseOrThrow(SprintUpdate, input);
  const sprint = await sprintRepository.findSprint(ctx.workspace.id, sprintId);
  if (!sprint) throw new AppError("NOT_FOUND", "Sprint not found");
  const next: Partial<Sprint> = { updatedAt: nowIso() };
  const diff: Record<string, unknown> = { sprint: { from: null, to: sprint.number } };
  if (patch.goal !== undefined && patch.goal !== sprint.goal) {
    next.goal = patch.goal;
    next.autoGoal = patch.goal === "";
    diff.goal = { from: sprint.goal, to: patch.goal };
  }
  if (patch.capacityPoints !== undefined && patch.capacityPoints !== sprint.capacityPoints) {
    next.capacityPoints = patch.capacityPoints;
    diff.capacity = { from: sprint.capacityPoints, to: patch.capacityPoints };
  }
  if (Object.keys(diff).length > 1) {
    await sprintRepository.updateSprint(ctx.workspace.id, sprintId, next);
    await audit(ctx, sprint.projectId, "sprint.updated", diff);
  }
  return refreshAutoGoals(ctx, sprint.projectId);
}
