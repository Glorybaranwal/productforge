import { beforeEach, describe, expect, it } from "vitest";

import * as analyzeRoute from "@/app/api/changes/[id]/analyze/route";
import * as approveChangeRoute from "@/app/api/changes/[id]/approve/route";
import * as discardRoute from "@/app/api/changes/[id]/discard/route";
import * as reviewsRoute from "@/app/api/changes/[id]/reviews/route";
import * as approveAllRoute from "@/app/api/projects/[id]/backlog/approve/route";
import * as generateRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as backlogRoute from "@/app/api/projects/[id]/backlog/route";
import * as changesRoute from "@/app/api/projects/[id]/changes/route";
import * as exportsRoute from "@/app/api/projects/[id]/exports/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as planRoute from "@/app/api/projects/[id]/sprints/plan/route";
import * as boardRoute from "@/app/api/projects/[id]/sprints/route";
import * as traceRoute from "@/app/api/projects/[id]/traceability/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as approvePrdRoute from "@/app/api/prds/[id]/approve/route";
import * as prdVersionRoute from "@/app/api/prds/[id]/new-version/route";
import * as storyVersionRoute from "@/app/api/stories/[id]/new-version/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { AppError } from "@/src/lib/errors";
import type { ExportOverview } from "@/src/modules/exports/service";
import { proposeChange } from "@/src/modules/impact/service";
import type { ChangesOverview } from "@/src/modules/impact/view";
import type { PrdState } from "@/src/modules/prd/service";
import type { SprintBoard } from "@/src/modules/sprints/board";
import type { BacklogState } from "@/src/modules/stories/state";
import type { Traceability } from "@/src/modules/traceability/schema";
import { currentContext } from "@/src/modules/workspaces/service";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { resetDb, validProject } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = async <T>(
  route: { GET: (r: Request, p: ReturnType<typeof params>) => Promise<Response> },
  id: string,
) => (await (await route.GET(req("GET"), params(id))).json()) as T;
const overview = (id: string) => get<ChangesOverview>(changesRoute, id);
const backlog = (id: string) => get<BacklogState>(backlogRoute, id);
const propose = (id: string, body: unknown, key?: string) =>
  changesRoute.POST(req("POST", body, key ? { "idempotency-key": key } : {}), params(id));

const CSV_TO_PDF = {
  kind: "modify",
  requirementCode: "FR-07",
  text: "Reports can be downloaded as PDF and Excel files",
  evidence: "EXPLICIT",
  reason: "Finance confirmed the formats",
};

/** Demo project through Gate 3 with a sprint plan. FR-07 (report format, an assumption) is linked by US-003. */
async function built() {
  const { projectId } = await projectThroughGate2();
  await generateRoute.POST(req("POST"), params(projectId));
  await approveAllRoute.POST(req("POST"), params(projectId));
  await planRoute.POST(req("POST", {}), params(projectId));
  return projectId;
}

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("change requests (PF-053)", () => {
  it("only after Gate 1, and only for managers", async () => {
    const { project } = (await (await projectsRoute.POST(req("POST", validProject))).json()) as {
      project: { id: string };
    };
    expect((await overview(project.id)).gate1Passed).toBe(false);
    const early = await propose(project.id, CSV_TO_PDF);
    expect(early.status).toBe(409);
    const { projectId } = await projectThroughGate1();
    const ctx = await currentContext();
    const err = await proposeChange({ ...ctx, role: "qa" }, projectId, CSV_TO_PDF, null).catch(
      (e: unknown) => e,
    );
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect((await overview(projectId)).gate1Passed).toBe(true);
  });

  it("a proposal explains the impact and changes nothing yet", async () => {
    const projectId = await built();
    const res = await propose(projectId, CSV_TO_PDF, "k-1");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; status: string; agentRunId: string };
    expect(body).toMatchObject({ code: "CR-01", status: "succeeded" });
    const again = (await (await propose(projectId, CSV_TO_PDF, "k-1")).json()) as {
      replayed: boolean;
      code: string;
    };
    expect(again).toMatchObject({ replayed: true, code: "CR-01" });

    const o = await overview(projectId);
    expect(o.changes).toHaveLength(1);
    const cr = o.changes[0]!;
    expect(cr).toMatchObject({
      status: "DRAFT",
      kind: "modify",
      requirementCode: "FR-07",
      needsAnalysis: false,
    });
    expect(cr.affected).toEqual({ prd: true, stories: ["US-003"] });
    expect(cr.impact!.items.map((i) => [i.ref, i.severity])).toEqual([
      ["PRD", "high"],
      ["US-003/AC-4", "high"],
      ["US-003", "high"],
    ]);
    expect(o.requirements.find((r) => r.code === "FR-07")).toMatchObject({
      version: 1,
      proposed: "CR-01",
    });
    const b = await backlog(projectId);
    expect(b.review).toEqual({ stories: [], changes: [] });
    expect(b.gate3.passed).toBe(true);
  });

  it("refuses proposals that change nothing, target unknown or busy requirements", async () => {
    const projectId = await built();
    const same = await propose(projectId, {
      ...CSV_TO_PDF,
      text: "Reports can be downloaded as CSV until the required format is confirmed",
      evidence: "ASSUMPTION",
    });
    expect(same.status).toBe(400);
    expect(
      ((await same.json()) as { error: { details: { path: string }[] } }).error.details[0]!.path,
    ).toBe("text");
    expect((await propose(projectId, { ...CSV_TO_PDF, reason: "" })).status).toBe(400);
    expect((await propose(projectId, { ...CSV_TO_PDF, requirementCode: "FR-99" })).status).toBe(
      404,
    );
    expect((await propose(projectId, CSV_TO_PDF)).status).toBe(201);
    expect(
      (
        await propose(projectId, {
          kind: "withdraw",
          requirementCode: "FR-07",
          reason: "Changed my mind",
        })
      ).status,
    ).toBe(409);
  });

  it("approving versions the requirement and flags the PRD, stories, sprint board, traceability and export", async () => {
    const projectId = await built();
    const { changeId } = (await (await propose(projectId, CSV_TO_PDF)).json()) as {
      changeId: string;
    };
    expect((await approveChangeRoute.POST(req("POST"), params(changeId))).status).toBe(200);
    expect((await approveChangeRoute.POST(req("POST"), params(changeId))).status).toBe(409);

    const o = await overview(projectId);
    expect(o.requirements.find((r) => r.code === "FR-07")).toMatchObject({
      version: 2,
      evidence: "EXPLICIT",
      text: CSV_TO_PDF.text,
      changedBy: "CR-01",
    });
    expect(o.changes[0]!.review.map((r) => [r.ref, r.state])).toEqual([
      ["PRD", "pending"],
      ["US-003", "pending"],
    ]);
    expect(o.pending).toBe(2);

    const b = await backlog(projectId);
    expect(b.stories.find((s) => s.code === "US-003")!.review.map((f) => f.change)).toEqual([
      "CR-01",
    ]);
    expect(b.gate3.passed).toBe(false);
    expect(b.gate3.blockers).toContain("US-003 needs review after a requirement change");
    expect(b.requirements.find((r) => r.code === "FR-07")!.version).toBe(2);
    expect((await get<PrdState>(prdStateRoute, projectId)).review.map((f) => f.title)).toEqual([
      "FR-07 changed",
    ]);
    const board = await get<SprintBoard>(boardRoute, projectId);
    expect(board.review).toEqual({
      stories: [{ code: "US-003", sprint: 1 }],
      changes: ["CR-01: FR-07 changed"],
    });
    const trace = await get<Traceability>(traceRoute, projectId);
    expect(trace.gaps.slice(0, 2).map((g) => g.message)).toEqual([
      "The approved PRD needs review after CR-01: FR-07 changed",
      "US-003 needs review after CR-01: FR-07 changed",
    ]);
    const exp = await get<ExportOverview>(exportsRoute, projectId);
    expect(exp.plan.warnings).toContain(
      "US-003 needs review after a requirement change (CR-01: FR-07 changed) — check before exporting.",
    );
  });

  it("flags clear when the item gets a new version or is marked reviewed", async () => {
    const projectId = await built();
    const { changeId } = (await (await propose(projectId, CSV_TO_PDF)).json()) as {
      changeId: string;
    };
    await approveChangeRoute.POST(req("POST"), params(changeId));

    const mark = (ref: string, note = "") =>
      reviewsRoute.POST(req("POST", { ref, note }), params(changeId));
    expect((await mark("US-001")).status).toBe(404);
    expect((await mark("US-003", "Copy fixed in the description")).status).toBe(200);
    expect((await mark("US-003")).status).toBe(409);

    const prd = await get<PrdState>(prdStateRoute, projectId);
    const { prd: v2 } = (await (
      await prdVersionRoute.POST(req("POST"), params(prd.versions[0]!.id))
    ).json()) as { prd: { id: string } };
    expect((await approvePrdRoute.POST(req("POST"), params(v2.id))).status).toBe(200);

    const o = await overview(projectId);
    expect(o.changes[0]!.review.map((r) => [r.ref, r.state, r.note])).toEqual([
      ["PRD", "updated", null],
      ["US-003", "reviewed", "Copy fixed in the description"],
    ]);
    expect(o.pending).toBe(0);
    expect((await backlog(projectId)).gate3.passed).toBe(true);
    expect((await get<PrdState>(prdStateRoute, projectId)).review).toEqual([]);
  });

  it("withdrawing: a story that only covered it is flagged; a new version clears the flag", async () => {
    const projectId = await built();
    const { changeId } = (await (
      await propose(projectId, {
        kind: "withdraw",
        requirementCode: "FR-07",
        reason: "Reports move to v2",
      })
    ).json()) as { changeId: string };
    await approveChangeRoute.POST(req("POST"), params(changeId));
    const o = await overview(projectId);
    expect(o.requirements.find((r) => r.code === "FR-07")).toMatchObject({
      status: "REJECTED",
      version: 2,
      changedBy: "CR-01",
    });
    let b = await backlog(projectId);
    expect(b.requirements.map((r) => r.code)).not.toContain("FR-07");
    const us3 = b.stories.find((s) => s.code === "US-003")!;
    expect(us3.review).toHaveLength(1);

    await storyVersionRoute.POST(req("POST"), params(us3.id));
    b = await backlog(projectId);
    const v2 = b.stories.find((s) => s.code === "US-003")!;
    expect(v2).toMatchObject({ version: 2, status: "DRAFT", review: [] });
    expect(v2.blockers.join(" ")).toContain("FR-07");
    expect(
      (await overview(projectId)).changes[0]!.review.find((r) => r.ref === "US-003")!.state,
    ).toBe("updated");
  });

  it("adding: the new requirement gets the next code and the backlog can cover it", async () => {
    const projectId = await built();
    const { changeId } = (await (
      await propose(projectId, {
        kind: "add",
        text: "Customers can export transactions as a PDF statement",
        reason: "Support requests",
      })
    ).json()) as { changeId: string };
    let o = await overview(projectId);
    expect(o.changes[0]).toMatchObject({
      requirementCode: null,
      affected: { prd: true, stories: [] },
    });
    await approveChangeRoute.POST(req("POST"), params(changeId));
    o = await overview(projectId);
    const added = o.requirements.at(-1)!;
    expect(added).toMatchObject({
      code: "FR-08",
      version: 1,
      status: "APPROVED",
      changedBy: "CR-01",
    });
    expect(o.changes[0]!.review.map((r) => [r.ref, r.state])).toEqual([["PRD", "pending"]]);
    const b = await backlog(projectId);
    expect(b.coverage.uncovered).toEqual(["FR-08"]);
    await generateRoute.POST(req("POST"), params(projectId));
    expect((await backlog(projectId)).coverage.uncovered).toEqual([]);
  });

  it("discarding leaves everything as it was; analysis can be re-run on a proposal", async () => {
    const projectId = await built();
    const { changeId } = (await (await propose(projectId, CSV_TO_PDF)).json()) as {
      changeId: string;
    };
    const again = (await (await analyzeRoute.POST(req("POST"), params(changeId))).json()) as {
      status: string;
    };
    expect(again.status).toBe("succeeded");
    expect((await discardRoute.POST(req("POST"), params(changeId))).status).toBe(200);
    expect((await approveChangeRoute.POST(req("POST"), params(changeId))).status).toBe(409);
    expect((await analyzeRoute.POST(req("POST"), params(changeId))).status).toBe(409);
    const o = await overview(projectId);
    expect(o.changes[0]!.status).toBe("REJECTED");
    expect(o.requirements.find((r) => r.code === "FR-07")).toMatchObject({
      version: 1,
      proposed: null,
    });
    expect((await backlog(projectId)).gate3.passed).toBe(true);
  });
});
