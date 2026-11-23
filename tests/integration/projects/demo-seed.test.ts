import { beforeEach, describe, expect, it } from "vitest";

import { createDemoClient } from "@/src/ai/demo/demo-client";
import { getLLMClient, setLLMClient } from "@/src/ai/llm-client";
import { DEMO_PROJECT_NAME, seedDemoProject } from "@/src/modules/projects/demo-seed";
import { createProject, listProjects } from "@/src/modules/projects/service";
import { getDiscoveryState, runDiscovery } from "@/src/modules/requirements/discovery-service";
import { addSource } from "@/src/modules/sources/service";
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

    expect(backlog.stories.every((s) => s.criteria.length > 0 && s.tasks.length > 0)).toBe(true);

    const board = await getSprintBoard(ctx, projectId);
    expect(board.sprints.length).toBeGreaterThan(0);
    expect(board.sprints.some((sp) => sp.stories.length > 0)).toBe(true);
  });

  it("is idempotent: a second call returns the same project and creates nothing", async () => {
    const ctx = await makeContext("owner");
    const first = await seedDemoProject(ctx);
    const second = await seedDemoProject(ctx);
    expect(second).toEqual({ projectId: first.projectId, created: false, completed: [] });
    expect(await listProjects(ctx)).toHaveLength(1);
  });

  it("finishes a half-built project: runs only the missing steps, then changes nothing", async () => {
    const ctx = await makeContext("owner");
    const project = await createProject(ctx, {
      name: DEMO_PROJECT_NAME,
      domain: "Fintech",
      audience: "Retail banking customers",
      teamSize: 5,
      sprintLengthDays: 14,
    });
    await addSource(ctx, project.id, {
      name: "Kickoff notes",
      text: "Customers can view transactions.",
    });

    const resumed = await seedDemoProject(ctx);
    expect(resumed.projectId).toBe(project.id);
    expect(resumed.created).toBe(false);
    expect(resumed.completed).toEqual([
      "run discovery",
      "resolve questions",
      "confirm requirements (Gate 1)",
      "generate PRD",
      "approve PRD (Gate 2)",
      "generate backlog",
      "approve stories",
      "plan sprints",
    ]);
    expect((await getPrdState(ctx, project.id)).versions[0]!.status).toBe("APPROVED");
    const counts = async () => ({
      projects: (await listProjects(ctx)).length,
      requirements: (await getDiscoveryState(ctx, project.id)).requirements.length,
      stories: (await getBacklogState(ctx, project.id)).stories.length,
      sprints: (await getSprintBoard(ctx, project.id)).sprints.length,
    });
    const before = await counts();
    expect(before.stories).toBeGreaterThan(0);
    expect(before.sprints).toBeGreaterThan(0);

    expect(await seedDemoProject(ctx)).toEqual({
      projectId: project.id,
      created: false,
      completed: [],
    });
    expect(await counts()).toEqual(before);
  });

  it("resumes after a discovery run: keeps that discovery and runs every later step", async () => {
    const ctx = await makeContext("owner");
    const { projectId } = await seedDemoProject(ctx);
    // A fresh workspace seeded fully is complete; a second one stopped after Gate 1 resumes after it.
    const ctx2 = await makeContext("owner");
    const p = await createProject(ctx2, {
      name: DEMO_PROJECT_NAME,
      domain: "Fintech",
      audience: "Retail banking customers",
      teamSize: 5,
      sprintLengthDays: 14,
    });
    await addSource(ctx2, p.id, {
      name: "Kickoff notes",
      text: "Customers can view transactions.",
    });
    await runDiscovery(ctx2, p.id, null);
    const out = await seedDemoProject(ctx2);
    expect(out.completed[0]).toBe("resolve questions");
    expect(out.completed).not.toContain("run discovery");
    expect(out.completed).not.toContain("add source");
    expect(projectId).not.toBe(p.id);
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
