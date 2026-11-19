import { beforeEach, describe, expect, it } from "vitest";

import * as activityRoute from "@/app/api/projects/[id]/activity/route";
import * as approveAllRoute from "@/app/api/projects/[id]/backlog/approve/route";
import * as generateRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as csvRoute from "@/app/api/projects/[id]/traceability/csv/route";
import * as traceRoute from "@/app/api/projects/[id]/traceability/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as approvePrdRoute from "@/app/api/prds/[id]/approve/route";
import * as newPrdVersionRoute from "@/app/api/prds/[id]/new-version/route";
import * as regenerateRoute from "@/app/api/stories/[id]/regenerate/route";
import * as rejectRoute from "@/app/api/stories/[id]/reject/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { AuditLog } from "@/src/modules/audit/schema";
import type { Prd } from "@/src/modules/prd/schema";
import type { Project } from "@/src/modules/projects/schema";
import type { PrdState } from "@/src/modules/prd/service";
import type { Traceability } from "@/src/modules/traceability/schema";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { resetDb, validProject } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const trace = async (projectId: string) =>
  (await (await traceRoute.GET(req("GET"), params(projectId))).json()) as Traceability;

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("Traceability (PF-043)", () => {
  it("is empty before Gate 1, and follows requirements into the PRD after Gate 2", async () => {
    const { project } = (await (await projectsRoute.POST(req("POST", validProject))).json()) as {
      project: Project;
    };
    const before = await trace(project.id);
    expect([before.gate1Passed, before.score, before.requirements]).toEqual([false, null, []]);

    const { projectId } = await projectThroughGate1();
    const gate1 = await trace(projectId);
    expect(gate1.gate1Passed).toBe(true);
    expect(gate1.coverage.inPrd).toBe(0);

    const { projectId: p2 } = await projectThroughGate2();
    const t = await trace(p2);
    expect(t.coverage.inPrd).toBe(t.coverage.required);
    expect(t.score).toBe(20); // 1 of 5 steps: in the PRD
    expect(t.gaps.map((g) => g.kind)).toEqual(["no_story", "waiting"]);
  });

  it("scores the full chain and reaches 100 % when every story is approved", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    let t = await trace(projectId);
    expect(t.score).toBe(80);
    expect(
      t.requirements.filter((r) => r.status !== "waiting").every((r) => r.status === "in_review"),
    ).toBe(true);
    expect(t.coverage).toMatchObject({
      withStory: t.coverage.required,
      testable: t.coverage.required,
      estimated: t.coverage.required,
      approved: 0,
      waiting: 1,
    });
    expect(t.gaps.map((g) => g.kind)).toEqual(["not_approved", "waiting"]);
    expect(t.totals.criteria).toBeGreaterThan(t.totals.stories * 2 - 1);

    await approveAllRoute.POST(req("POST"), params(projectId));
    t = await trace(projectId);
    expect([t.score, t.approvedStoriesTraced, t.coverage.approved]).toEqual([
      100,
      100,
      t.coverage.required,
    ]);
    expect(t.gaps.map((g) => g.kind)).toEqual(["waiting"]);
    // An open question is answered after Gate 1 through a change request (PF-053).
    expect(t.gaps[0]!.action).toEqual({
      label: "Propose a change",
      href: `/dashboard/projects/${projectId}/changes`,
    });
    const fr = t.requirements.find((r) => r.code === "FR-01")!;
    expect(fr.prdSections).toContain("Functional requirements");
    expect(fr.stories[0]!.status).toBe("APPROVED");
  });

  it("rejecting a story drops coverage and lists the requirement it left behind", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    const before = await trace(projectId);
    const victim = before.stories.find((s) => s.requirementCodes.length === 1)!;
    const code = victim.requirementCodes[0]!;

    await rejectRoute.POST(req("POST", { reason: "Out of scope for v1" }), params(victim.id));
    const after = await trace(projectId);
    expect(after.coverage.withStory).toBe(before.coverage.withStory - 1);
    expect(after.score).toBeLessThan(before.score!);
    const row = after.requirements.find((r) => r.code === code)!;
    expect([row.status, row.stories.length, row.rejected[0]!.code]).toEqual([
      "rejected_only",
      0,
      victim.code,
    ]);
    const gap = after.gaps.find((g) => g.kind === "rejected_only")!;
    expect(gap.codes).toEqual([code, victim.code]);
    expect(gap.message).toBe(`${code} lost its story: ${victim.code} was rejected`);
    expect(gap.action).toEqual({
      label: `Regenerate ${victim.code}`,
      href: `/dashboard/projects/${projectId}/backlog?story=${victim.code}`,
    });

    await regenerateRoute.POST(req("POST", { note: "" }), params(victim.id));
    expect((await trace(projectId)).coverage.withStory).toBe(before.coverage.withStory);
  });

  it("flags stories written from an older PRD once a new PRD version is approved", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    const prd = (await (await prdStateRoute.GET(req("GET"), params(projectId))).json()) as PrdState;
    const { prd: v2 } = (await (
      await newPrdVersionRoute.POST(req("POST"), params(prd.versions[0]!.id))
    ).json()) as { prd: Prd };
    await approvePrdRoute.POST(req("POST"), params(v2.id));
    const t = await trace(projectId);
    expect(t.prdVersion).toBe(2);
    expect(t.stories.every((s) => s.stale)).toBe(true);
    expect(t.gaps.filter((g) => g.kind === "stale_story").length).toBe(t.stories.length);
  });

  it("exports the matrix as CSV and audit-logs the export", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    const res = await csvRoute.GET(req("GET"), params(projectId));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("traceability.csv");
    const lines = (await res.text()).trim().split("\r\n");
    const t = await trace(projectId);
    expect(lines.length).toBe(t.requirements.length + 1);
    expect(lines[0]).toBe(
      "Requirement,Type,Evidence,Text,PRD sections,Stories,Story status,Criteria (positive/negative/edge),Tasks,Hours,Trace status,Trace score %",
    );
    expect(lines[1]!.startsWith("FR-01,Functional,")).toBe(true);
    const { activity } = (await (
      await activityRoute.GET(req("GET"), params(projectId))
    ).json()) as { activity: AuditLog[] };
    expect(activity.some((a) => a.action === "traceability.exported")).toBe(true);
  });
});
