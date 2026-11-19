import { beforeEach, describe, expect, it } from "vitest";

import * as approveAllRoute from "@/app/api/projects/[id]/backlog/approve/route";
import * as generateRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as backlogRoute from "@/app/api/projects/[id]/backlog/route";
import * as moveRoute from "@/app/api/projects/[id]/sprints/move/route";
import * as planRoute from "@/app/api/projects/[id]/sprints/plan/route";
import * as boardRoute from "@/app/api/projects/[id]/sprints/route";
import * as settingsRoute from "@/app/api/projects/[id]/sprints/settings/route";
import * as sprintRoute from "@/app/api/sprints/[id]/route";
import * as newVersionRoute from "@/app/api/stories/[id]/new-version/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { AppError } from "@/src/lib/errors";
import { listAudit } from "@/src/modules/audit/service";
import type { SprintBoard } from "@/src/modules/sprints/board";
import { planProjectSprints } from "@/src/modules/sprints/service";
import type { BacklogState } from "@/src/modules/stories/state";
import { currentContext } from "@/src/modules/workspaces/service";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { resetDb } from "@/tests/helpers/context";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res: Response) => (await res.json()) as SprintBoard;
const board = async (id: string) => json(await boardRoute.GET(req("GET"), params(id)));
const plan = (id: string, body: unknown = {}) => planRoute.POST(req("POST", body), params(id));
const move = (id: string, storyCode: string, sprintNumber: number | null) =>
  moveRoute.POST(req("POST", { storyCode, sprintNumber }), params(id));
const where = (b: SprintBoard) =>
  Object.fromEntries(b.sprints.flatMap((sp) => sp.stories.map((s) => [s.code, sp.number])));

/** Demo backlog: US-001 (Should) is needed by the Musts US-002..US-005; US-006 is a Must. 5 points each. */
async function backlog(approve = true) {
  const { projectId } = await projectThroughGate2();
  await generateRoute.POST(req("POST"), params(projectId));
  if (approve) await approveAllRoute.POST(req("POST"), params(projectId));
  const state = (await (
    await backlogRoute.GET(req("GET"), params(projectId))
  ).json()) as BacklogState;
  return { projectId, stories: state.stories };
}

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("sprint planning (PF-051, PF-052)", () => {
  it("is locked until a story is approved", async () => {
    const { projectId, stories } = await backlog(false);
    const b = await board(projectId);
    expect(b.ready).toBe(false);
    expect(b.settings).toMatchObject({ velocity: 25, saved: false });
    expect(b.drafts).toEqual(stories.map((s) => s.code));
    const res = await plan(projectId);
    expect(res.status).toBe(409);
  });

  it("plans with a suggested velocity: dependencies first, within capacity, Must before Should before Could", async () => {
    const { projectId, stories } = await backlog();
    const res = await plan(projectId);
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.settings).toMatchObject({ velocity: 25, saved: true }); // 5 people × 5 points, two-week sprints
    expect(new Date(`${b.settings!.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
    const at = where(b);
    for (const s of stories)
      for (const d of s.dependsOn) expect(at[d]!).toBeLessThanOrEqual(at[s.code]!);
    for (const sp of b.sprints) expect(sp.points).toBeLessThanOrEqual(sp.capacity);
    expect(b.unplanned).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.forecast).toEqual({ sprints: 2, points: 30, end: b.sprints[1]!.end });
    expect(b.sprints[0]!.stories.find((s) => s.code === "US-001")!.reason).toContain(
      "need it first",
    );
    expect(b.sprints[0]!.goal).toMatch(/^Deliver /);
    const audit = await listAudit(await currentContext(), "project", projectId);
    expect(audit.map((a) => a.action)).toContain("sprints.planned");
  });

  it("validates settings, and sprints at the old velocity follow the new one", async () => {
    const { projectId } = await backlog();
    await plan(projectId);
    const bad = await settingsRoute.PUT(
      req("PUT", { velocity: 0, startDate: "next week" }),
      params(projectId),
    );
    expect(bad.status).toBe(400);
    const { error } = (await bad.json()) as { error: { details: { path: string }[] } };
    expect(error.details.map((d) => d.path).sort()).toEqual(["startDate", "velocity"]);

    const ok = await json(
      await settingsRoute.PUT(
        req("PUT", { velocity: 10, startDate: "2027-01-04" }),
        params(projectId),
      ),
    );
    expect(ok.sprints.map((s) => s.capacity)).toEqual([10, 10]);
    expect(ok.sprints[0]!.start).toBe("2027-01-04");
    expect(ok.warnings).toContain("Sprint 1 is over capacity: 25 of 10 points");
    const replanned = await json(await plan(projectId));
    expect(replanned.forecast.sprints).toBe(3);
    expect(replanned.warnings).toEqual([]);
  });

  it("flags the dependency and capacity problems a hand move creates, and keeps it on re-plan", async () => {
    const { projectId } = await backlog();
    await plan(projectId);
    let b = await json(await move(projectId, "US-006", 1));
    expect(b.warnings).toEqual(["Sprint 1 is over capacity: 30 of 25 points"]);
    b = await json(await move(projectId, "US-001", 2));
    expect(where(b)["US-001"]).toBe(2);
    expect(b.sprints[1]!.stories.find((s) => s.code === "US-001")!.pinned).toBe(true);
    expect(b.warnings).toContain(
      "US-002 (sprint 1): Depends on US-001 in sprint 2, which comes later",
    );
    expect(b.sprints[0]!.stories.find((s) => s.code === "US-002")!.problems).toEqual([
      "Depends on US-001 in sprint 2, which comes later",
    ]);
    // Re-plan keeps US-001 where it was put and moves what depends on it after it.
    b = await json(await plan(projectId, { keepPinned: true }));
    const at = where(b);
    expect(at["US-001"]).toBe(2);
    for (const c of ["US-002", "US-003", "US-004", "US-005"])
      expect(at[c]!).toBeGreaterThanOrEqual(2);
    expect(b.warnings).toEqual([]);
    // From scratch drops the pin.
    b = await json(await plan(projectId, { keepPinned: false }));
    expect(where(b)["US-001"]).toBe(1);
  });

  it("can open the next sprint by moving a story there, and take a story out of the plan", async () => {
    const { projectId } = await backlog();
    await plan(projectId);
    let b = await json(await move(projectId, "US-006", 3));
    expect(b.sprints.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(b.sprints[2]!.capacity).toBe(25);
    expect((await move(projectId, "US-006", 5)).status).toBe(400);
    b = await json(await move(projectId, "US-005", null));
    expect(b.unplanned.map((s) => [s.code, s.reason])).toEqual([
      ["US-005", "Not planned — drag it into a sprint or re-plan"],
    ]);
    expect((await move(projectId, "US-999", 1)).status).toBe(404);
  });

  it("lets the PM place stories by hand before any automatic plan", async () => {
    const { projectId } = await backlog();
    expect((await move(projectId, "US-001", 2)).status).toBe(400); // no sprint 1 yet
    let b = await json(await move(projectId, "US-001", 1));
    expect(b.settings).toMatchObject({ velocity: 25, saved: true });
    expect(b.sprints.map((s) => [s.number, s.capacity, s.goal])).toEqual([
      [1, 25, "Deliver Accounts & access"],
    ]);
    expect(b.unplanned).toHaveLength(5);
    b = await json(await plan(projectId));
    expect(where(b)["US-001"]).toBe(1);
    expect(b.unplanned).toEqual([]);
  });

  it("keeps a goal the PM wrote, and a zero-capacity sprint stays empty", async () => {
    const { projectId } = await backlog();
    let b = await json(await plan(projectId));
    const [one, two] = b.sprints;
    b = await json(
      await sprintRoute.PATCH(
        req("PATCH", { goal: "Sign-in and the transaction list" }),
        params(one!.id),
      ),
    );
    expect(b.sprints[0]!).toMatchObject({
      goal: "Sign-in and the transaction list",
      autoGoal: false,
    });
    b = await json(await move(projectId, "US-006", 1));
    expect(b.sprints[0]!.goal).toBe("Sign-in and the transaction list");

    b = await json(await sprintRoute.PATCH(req("PATCH", { capacityPoints: 0 }), params(two!.id)));
    b = await json(await plan(projectId, { keepPinned: false }));
    expect(b.sprints[1]!.stories).toEqual([]);
    expect(b.sprints[1]!.goal).toBe("");
    expect(b.sprints[0]!.goal).toBe("Sign-in and the transaction list");
    expect(where(b)["US-006"]).toBe(3);

    b = await json(await sprintRoute.PATCH(req("PATCH", { goal: "" }), params(one!.id)));
    expect(b.sprints[0]!.autoGoal).toBe(true);
    expect(b.sprints[0]!.goal).toMatch(/^Deliver /);
    expect((await sprintRoute.PATCH(req("PATCH", {}), params(one!.id))).status).toBe(400);
  });

  it("never changes approved stories, and flags a story that went back to draft", async () => {
    const { projectId, stories } = await backlog();
    await plan(projectId);
    const us1 = stories.find((s) => s.code === "US-001")!;
    const before = (await (
      await backlogRoute.GET(req("GET"), params(projectId))
    ).json()) as BacklogState;
    expect(before.stories.find((s) => s.code === "US-001")).toEqual(us1);

    await newVersionRoute.POST(req("POST"), params(us1.id));
    let b = await board(projectId);
    expect(b.warnings).toContain(
      "US-001 (sprint 1): Version 2 is a draft — approve it again before the sprint",
    );
    expect(b.drafts).toEqual(["US-001"]);
    expect((await move(projectId, "US-001", 2)).status).toBe(409);
    b = await json(await plan(projectId));
    expect(b.unplanned.map((s) => [s.code, s.reason])).toEqual(
      ["US-002", "US-003", "US-004", "US-005"].map((c) => [
        c,
        "Depends on US-001, which isn't approved",
      ]),
    );
    expect(where(b)).toEqual({ "US-006": 1 });
  });

  it("only managers plan sprints", async () => {
    const { projectId } = await backlog();
    const ctx = await currentContext();
    const err = await planProjectSprints({ ...ctx, role: "developer" }, projectId, {}).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
  });
});
