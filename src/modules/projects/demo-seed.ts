/**
 * The seeded demo project (PF-064): a fully worked "transaction monitoring dashboard" — sources,
 * requirements, PRD, backlog and sprint plan — built by driving the real services with the demo
 * engine, so it costs no tokens and comes out the same every time. Used by `pnpm db:seed`.
 */
import { createDemoClient } from "@/src/ai/demo/demo-client";
import { withLLMClient } from "@/src/ai/llm-client";
import { AppError } from "@/src/lib/errors";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import {
  confirmRequirements,
  getDiscoveryState,
  runDiscovery,
} from "@/src/modules/requirements/discovery-service";
import { resolveQuestion } from "@/src/modules/requirements/service";
import { generatePrd, approvePrd, getPrdState } from "@/src/modules/prd/service";
import { addSource } from "@/src/modules/sources/service";
import { nextMonday, suggestedVelocity } from "@/src/modules/sprints/schema";
import {
  getSprintBoard,
  planProjectSprints,
  saveSprintSettings,
} from "@/src/modules/sprints/service";
import {
  approveReadyStories,
  generateBacklog,
  getBacklogState,
} from "@/src/modules/stories/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { createProject, listProjects } from "./service";

export const DEMO_PROJECT_NAME = "Transaction monitoring dashboard (demo)";

/** Copy of the `input` of tests/ai-evals/fixtures/001-transaction-dashboard.json (runtime code never reads fixtures). */
const KICKOFF_NOTES =
  "Build a transaction monitoring dashboard where customers can view transactions, filter them, download reports, and receive notifications for failed transactions.";

const PROJECT = {
  domain: "Fintech",
  audience: "Retail banking customers",
  teamSize: 5,
  sprintLengthDays: 14,
};

/** Runs one seed step; a failure names the step, keeping the error code. */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = `Seed step "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
    throw err instanceof AppError
      ? new AppError(err.code, message, err.details)
      : new Error(message, { cause: err });
  }
}

/**
 * Creates the demo project for the context's workspace, or finishes it if an earlier run stopped
 * part-way: each step checks the project's state and runs only if it is missing. `completed` lists
 * the steps this call ran (empty when everything was already done).
 * Needs a manager role (owner, admin or pm), like the services it calls.
 */
export async function seedDemoProject(
  ctx: WorkspaceContext,
): Promise<{ projectId: string; created: boolean; completed: string[] }> {
  return withLLMClient(createDemoClient(), async () => {
    requireRole(ctx.role, MANAGER_ROLES, "seed the demo project");
    const completed: string[] = [];
    /** Runs a step when `needed()` says so; the state is read fresh before each step. */
    const run = async (
      name: string,
      needed: () => Promise<boolean>,
      fn: () => Promise<unknown>,
    ) => {
      if (!(await needed())) return;
      await step(name, fn);
      completed.push(name);
    };

    const existing = (await listProjects(ctx)).find((p) => p.name === DEMO_PROJECT_NAME);
    const project =
      existing ??
      (await step("create project", () =>
        createProject(ctx, { name: DEMO_PROJECT_NAME, ...PROJECT }),
      ));
    if (!existing) completed.push("create project");
    const projectId = project.id;

    const discovery = () => getDiscoveryState(ctx, projectId);
    const prds = () => getPrdState(ctx, projectId);
    const backlog = () => getBacklogState(ctx, projectId);
    const failedRun = (r: { status: string; error?: string | null } | undefined) => {
      if (r?.status === "failed") throw new Error(r.error ?? "the run failed");
    };

    await run(
      "add source",
      async () => (await discovery()).sources.length === 0,
      () => addSource(ctx, projectId, { name: "Kickoff notes", text: KICKOFF_NOTES }),
    );
    await run(
      "run discovery",
      async () => (await discovery()).discovery === null,
      async () => failedRun((await runDiscovery(ctx, projectId, null)).run),
    );
    await run(
      "resolve questions",
      async () => (await discovery()).questions.some((q) => q.state === "open"),
      async () => {
        const open = (await discovery()).questions.filter((q) => q.state === "open");
        for (const [i, q] of open.entries()) {
          await resolveQuestion(
            ctx,
            q.id,
            i === 0
              ? { state: "answered", answer: "Email and in-app notifications; customers only." }
              : { state: "skipped" },
          );
        }
      },
    );
    await run(
      "confirm requirements (Gate 1)",
      async () => (await discovery()).discovery?.status !== "confirmed",
      () => confirmRequirements(ctx, projectId),
    );
    await run(
      "generate PRD",
      async () => (await prds()).versions.length === 0,
      async () => failedRun((await generatePrd(ctx, projectId, null)).run),
    );
    await run(
      "approve PRD (Gate 2)",
      async () => !(await prds()).versions.some((v) => v.status === "APPROVED"),
      async () => {
        const latest = (await prds()).versions.at(-1);
        if (!latest) throw new Error("no PRD version was created");
        await approvePrd(ctx, latest.id);
      },
    );
    await run(
      "generate backlog",
      async () => {
        const { stories } = await backlog();
        return stories.length === 0 || stories.some((s) => !s.criteria.length || !s.tasks.length);
      },
      async () =>
        failedRun(
          (await generateBacklog(ctx, projectId, null)).runs.find((r) => r.status === "failed"),
        ),
    );
    await run(
      "approve stories",
      async () =>
        (await backlog()).stories.some((s) => s.status === "DRAFT" && s.blockers.length === 0),
      () => approveReadyStories(ctx, projectId),
    );
    await run(
      "plan sprints",
      async () => (await getSprintBoard(ctx, projectId)).sprints.length === 0,
      async () => {
        await saveSprintSettings(ctx, projectId, {
          velocity: suggestedVelocity(PROJECT.teamSize, PROJECT.sprintLengthDays),
          startDate: nextMonday(new Date().toISOString().slice(0, 10)),
        });
        await planProjectSprints(ctx, projectId, {});
      },
    );

    return { projectId, created: !existing, completed };
  });
}
