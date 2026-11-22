import { beforeEach, describe, expect, it } from "vitest";

import { createDemoClient } from "@/src/ai/demo/demo-client";
import { getLLMClient, setLLMClient } from "@/src/ai/llm-client";
import { DEMO_PROJECT_NAME, seedDemoProject } from "@/src/modules/projects/demo-seed";
import { listProjects } from "@/src/modules/projects/service";
import { getDiscoveryState } from "@/src/modules/requirements/discovery-service";
import { getPrdState } from "@/src/modules/prd/service";
import { getSprintBoard } from "@/src/modules/sprints/service";
import { getBacklogState } from "@/src/modules/stories/service";
import { makeContext, resetDb } from "@/tests/helpers/context";

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("seedDemoProject", () => {
  it("builds a worked project: approved requirements, PRD and stories, planned sprints", async () => {
    const ctx = await makeContext("owner");
    const { projectId, created } = await seedDemoProject(ctx);
    expect(created).toBe(true);

    const projects = await listProjects(ctx);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe(DEMO_PROJECT_NAME);

    const discovery = await getDiscoveryState(ctx, projectId);
    expect(discovery.sources.map((s) => s.name)).toEqual(["Kickoff notes"]);
    expect(discovery.discovery?.status).toBe("confirmed");
    expect(discovery.requirements.length).toBeGreaterThan(0);
    expect(discovery.requirements.every((r) => r.status === "APPROVED")).toBe(true);
    expect(discovery.questions.some((q) => q.state === "open")).toBe(false);

    const prd = await getPrdState(ctx, projectId);
    expect(prd.versions[0]!.status).toBe("APPROVED");

    const backlog = await getBacklogState(ctx, projectId);
    expect(backlog.stories.length).toBeGreaterThan(0);
    expect(backlog.stories.some((s) => s.status === "APPROVED")).toBe(true);

    const board = await getSprintBoard(ctx, projectId);
    expect(board.sprints.length).toBeGreaterThan(0);
  });

  it("is idempotent: a second call returns the same project and creates nothing", async () => {
    const ctx = await makeContext("owner");
    const first = await seedDemoProject(ctx);
    const second = await seedDemoProject(ctx);
    expect(second).toEqual({ projectId: first.projectId, created: false });
    expect(await listProjects(ctx)).toHaveLength(1);
  });

  it("needs a manager role", async () => {
    const ctx = await makeContext("developer");
    await expect(seedDemoProject(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listProjects(ctx)).toHaveLength(0);
  });

  it("restores the LLM client in effect before the call, on success and on failure", async () => {
    const mine = createDemoClient();
    setLLMClient(mine);
    await seedDemoProject(await makeContext("owner"));
    expect(getLLMClient()).toBe(mine);

    await expect(seedDemoProject(await makeContext("developer"))).rejects.toThrow();
    expect(getLLMClient()).toBe(mine);
  });
});
