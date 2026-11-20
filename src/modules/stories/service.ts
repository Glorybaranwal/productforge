import { runStage, type StageDeps } from "@/src/ai/orchestrator/run-stage";
import { qaStage } from "@/src/ai/stages/qa.stage";
import { storyStage } from "@/src/ai/stages/story.stage";
import { taskStage } from "@/src/ai/stages/task.stage";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { withIdempotency } from "@/src/lib/idempotency";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import { recordAudit } from "@/src/modules/audit/service";
import { recordExport } from "@/src/modules/exports/record";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { backlogToMarkdown } from "./markdown";
import { backlogRepository } from "./repository";
import { StoryRegeneration } from "./schema";
import { buildState, loadBacklog, requireGate2, type BacklogState } from "./state";

export * from "./edit";
export * from "./review";

export type BacklogStatus = {
  state: "locked" | "not_started" | "in_progress" | "passed";
  stories: number;
  approved: number;
  points: number;
};

const STAGES = ["story", "qa", "task"] as const;

async function latestRuns(ctx: WorkspaceContext, projectId: string): Promise<AgentRun[]> {
  const runs = await Promise.all(
    STAGES.map((stage) => agentRunRepository.latestForProject(ctx, projectId, stage)),
  );
  return runs.filter((r): r is AgentRun => r !== null);
}

export async function getBacklogState(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<BacklogState> {
  const [b, runs] = await Promise.all([loadBacklog(ctx, projectId), latestRuns(ctx, projectId)]);
  return buildState(b, runs);
}

export function summarizeBacklog(state: BacklogState): BacklogStatus {
  const live = state.stories.filter((s) => s.status !== "REJECTED").length;
  return {
    state: !state.gate2Passed
      ? "locked"
      : state.stories.length === 0
        ? "not_started"
        : state.gate3.passed
          ? "passed"
          : "in_progress",
    stories: live,
    approved: state.counts.approved,
    points: state.counts.points,
  };
}

export async function getBacklogStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<BacklogStatus> {
  return summarizeBacklog(buildState(await loadBacklog(ctx, projectId), []));
}

type Scope = { targetId?: string; note?: string };

/**
 * Story → QA → task, stopping at the first failed run. Without a target it only fills gaps:
 * stories for uncovered requirements, then criteria and tasks for drafts that have none.
 */
async function runPipeline(
  ctx: WorkspaceContext,
  projectId: string,
  scope: Scope,
  deps: StageDeps,
): Promise<AgentRun[]> {
  const sc = { ctx, projectId };
  const runs: AgentRun[] = [];
  const step = async (run: Promise<AgentRun>) => {
    const done = await run;
    runs.push(done);
    return done.status === "succeeded";
  };
  if (scope.targetId) {
    const only = { storyIds: [scope.targetId], note: scope.note };
    if (!(await step(runStage(storyStage(scope), sc, deps)))) return runs;
    if (!(await step(runStage(qaStage(only), sc, deps)))) return runs;
    await step(runStage(taskStage(only), sc, deps));
    return runs;
  }
  const pending = async () => buildState(await loadBacklog(ctx, projectId), []).pending;
  if ((await pending()).stories && !(await step(runStage(storyStage(), sc, deps)))) return runs;
  if ((await pending()).criteria && !(await step(runStage(qaStage(), sc, deps)))) return runs;
  if ((await pending()).tasks) await step(runStage(taskStage(), sc, deps));
  return runs;
}

type PipelineResult = { id: string; runs: AgentRun[] };

async function idempotentPipeline(
  ctx: WorkspaceContext,
  scope: string,
  key: string | null,
  work: () => Promise<AgentRun[]>,
): Promise<{ runs: AgentRun[]; replayed: boolean }> {
  const { result, replayed } = await withIdempotency<PipelineResult>(
    ctx,
    scope,
    key,
    async () => {
      const runs = await work();
      return { id: runs.map((r) => r.id).join(",") || "none", runs };
    },
    async (id) => {
      const ids = id === "none" ? [] : id.split(",");
      const runs = await Promise.all(ids.map((r) => agentRunRepository.findById(ctx, r)));
      return { id, runs: runs.filter((r): r is AgentRun => r !== null) };
    },
  );
  return { runs: result.runs, replayed };
}

const failed = (runs: AgentRun[]) => runs.find((r) => r.status === "failed") ?? null;

/** "Generate backlog" / "Fill gaps" (PF-034, PF-040, PF-041). Never replaces anything people kept. */
export async function generateBacklog(
  ctx: WorkspaceContext,
  projectId: string,
  idempotencyKey: string | null,
  deps: StageDeps = {},
): Promise<{ runs: AgentRun[]; replayed: boolean }> {
  requireRole(ctx.role, MANAGER_ROLES, "generate the backlog");
  requireGate2(await loadBacklog(ctx, projectId));
  const before = (await backlogRepository.load(ctx, projectId)).stories.length;
  const out = await idempotentPipeline(ctx, `backlog:${projectId}`, idempotencyKey, () =>
    runPipeline(ctx, projectId, {}, deps),
  );
  if (!out.replayed && out.runs.length) {
    const after = (await backlogRepository.load(ctx, projectId)).stories.length;
    await recordAudit(ctx, {
      entityType: "project",
      entityId: projectId,
      action: failed(out.runs) ? "backlog.failed" : "backlog.generated",
      diff: {
        stories: { from: before, to: after },
        runs: { from: null, to: out.runs.map((r) => `${r.stage}:${r.status}`).join(", ") },
      },
    });
  }
  return out;
}

/** "Regenerate with note" (PF-042): rewrites one draft or rejected story, then its criteria and tasks. */
export async function regenerateStory(
  ctx: WorkspaceContext,
  storyId: string,
  input: unknown,
  idempotencyKey: string | null,
  deps: StageDeps = {},
): Promise<{ runs: AgentRun[]; replayed: boolean }> {
  requireRole(ctx.role, MANAGER_ROLES, "regenerate stories");
  const { note } = parseOrThrow(StoryRegeneration, input ?? {});
  const story = await backlogRepository.findStory(ctx, storyId);
  if (!story) throw new AppError("NOT_FOUND", "Story not found");
  const out = await idempotentPipeline(ctx, `story:${storyId}`, idempotencyKey, () =>
    runPipeline(ctx, story.projectId, { targetId: storyId, note }, deps),
  );
  if (!out.replayed) {
    await recordAudit(ctx, {
      entityType: "project",
      entityId: story.projectId,
      action: failed(out.runs) ? "story.regenerate_failed" : "story.regenerated",
      diff: { story: { from: null, to: story.code }, note: { from: null, to: note || null } },
    });
  }
  return out;
}

/** Approved stories only, as Markdown (PF-042: only approved stories are exportable). */
export async function getBacklogMarkdown(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<{ markdown: string; filename: string }> {
  const state = await getBacklogState(ctx, projectId);
  const { project } = await loadBacklog(ctx, projectId);
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "backlog";
  await recordExport(ctx, projectId, "backlog", {
    format: "markdown",
    stories: state.counts.approved,
  });
  return { markdown: backlogToMarkdown(project.name, state), filename: `${slug}-backlog.md` };
}
