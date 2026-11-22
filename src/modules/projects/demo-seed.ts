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
import { planProjectSprints, saveSprintSettings } from "@/src/modules/sprints/service";
import { approveReadyStories, generateBacklog } from "@/src/modules/stories/service";
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
 * Creates the demo project for the context's workspace, or returns the existing one.
 * Needs a manager role (owner, admin or pm), like the services it calls.
 */
export async function seedDemoProject(
  ctx: WorkspaceContext,
): Promise<{ projectId: string; created: boolean }> {
  return withLLMClient(createDemoClient(), async () => {
    requireRole(ctx.role, MANAGER_ROLES, "seed the demo project");
    const existing = (await listProjects(ctx)).find((p) => p.name === DEMO_PROJECT_NAME);
    if (existing) return { projectId: existing.id, created: false };

    const project = await step("create project", () =>
      createProject(ctx, { name: DEMO_PROJECT_NAME, ...PROJECT }),
    );
    const projectId = project.id;

    await step("add source", () =>
      addSource(ctx, projectId, { name: "Kickoff notes", text: KICKOFF_NOTES }),
    );

    await step("run discovery", async () => {
      const { run } = await runDiscovery(ctx, projectId, null);
      if (run.status === "failed") throw new Error(run.error ?? "the run failed");
    });

    await step("resolve questions", async () => {
      const open = (await getDiscoveryState(ctx, projectId)).questions.filter(
        (q) => q.state === "open",
      );
      for (const [i, q] of open.entries()) {
        await resolveQuestion(
          ctx,
          q.id,
          i === 0
            ? { state: "answered", answer: "Email and in-app notifications; customers only." }
            : { state: "skipped" },
        );
      }
    });

    await step("confirm requirements (Gate 1)", () => confirmRequirements(ctx, projectId));

    await step("generate PRD", async () => {
      const { run } = await generatePrd(ctx, projectId, null);
      if (run.status === "failed") throw new Error(run.error ?? "the run failed");
    });
    await step("approve PRD (Gate 2)", async () => {
      const latest = (await getPrdState(ctx, projectId)).versions[0];
      if (!latest) throw new Error("no PRD version was created");
      await approvePrd(ctx, latest.id);
    });

    await step("generate backlog", async () => {
      const { runs } = await generateBacklog(ctx, projectId, null);
      const failed = runs.find((r) => r.status === "failed");
      if (failed) throw new Error(failed.error ?? `the ${failed.stage} run failed`);
    });
    await step("approve stories", () => approveReadyStories(ctx, projectId));

    await step("plan sprints", async () => {
      await saveSprintSettings(ctx, projectId, {
        velocity: suggestedVelocity(PROJECT.teamSize, PROJECT.sprintLengthDays),
        startDate: nextMonday(new Date().toISOString().slice(0, 10)),
      });
      await planProjectSprints(ctx, projectId, {});
    });

    return { projectId, created: true };
  });
}
