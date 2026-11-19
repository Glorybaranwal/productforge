import { beforeEach, describe, expect, it } from "vitest";

import * as activityRoute from "@/app/api/projects/[id]/activity/route";
import * as generateRoute from "@/app/api/projects/[id]/prd/generate/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as approveRoute from "@/app/api/prds/[id]/approve/route";
import * as markdownRoute from "@/app/api/prds/[id]/markdown/route";
import * as newVersionRoute from "@/app/api/prds/[id]/new-version/route";
import * as prdRoute from "@/app/api/prds/[id]/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { Prd } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";
import { resetDb, validProject } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T>(res: Response) => (await res.json()) as T;
const state = async (projectId: string) =>
  json<PrdState>(await prdStateRoute.GET(req("GET"), params(projectId)));
const patch = (id: string, section: string, value: unknown) =>
  prdRoute.PATCH(req("PATCH", { section, value }), params(id));

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("PRD (Gate 2)", () => {
  it("can't be generated before Gate 1", async () => {
    const { project } = await json<{ project: { id: string } }>(
      await projectsRoute.POST(req("POST", validProject)),
    );
    expect((await generateRoute.POST(req("POST"), params(project.id))).status).toBe(409);
    expect((await state(project.id)).gate1Passed).toBe(false);
  });

  it("generates, edits, approves, versions and compares", async () => {
    const { projectId } = await projectThroughGate1();
    expect((await state(projectId)).blockers).toEqual(["Generate the PRD first"]);

    // Generate v1 (draft, AI origin, full traceability).
    const run = await json<{ status: string }>(
      await generateRoute.POST(req("POST"), params(projectId)),
    );
    expect(run.status).toBe("succeeded");
    let s = await state(projectId);
    const v1 = s.versions[0]!;
    expect([v1.version, v1.status, v1.origin]).toEqual([1, "DRAFT", "ai"]);
    expect(s.blockers).toEqual([]);

    // Autosave a section: origin becomes ai_edited.
    expect((await patch(v1.id, "summary", "Edited summary for the dashboard.")).status).toBe(200);
    expect((await patch(v1.id, "summary", "")).status).toBe(400);

    // Dropping a requirement's only link blocks Gate 2.
    const frs = v1.content.functionalRequirements;
    const dropped = frs[0]!.requirementCodes[0]!;
    await patch(v1.id, "functionalRequirements", frs.slice(1));
    s = await state(projectId);
    expect(s.versions[0]!.origin).toBe("ai_edited");
    expect(s.blockers.join(" ")).toContain(`not covered by the PRD: ${dropped}`);
    expect((await approveRoute.POST(req("POST"), params(v1.id))).status).toBe(409);

    // Restore it and approve.
    await patch(v1.id, "functionalRequirements", frs);
    const approved = await json<{ prd: Prd }>(await approveRoute.POST(req("POST"), params(v1.id)));
    expect(approved.prd.status).toBe("APPROVED");

    // Approved versions are frozen; editing starts v2 from a copy.
    expect((await patch(v1.id, "summary", "Change after approval")).status).toBe(409);
    const v2 = (await json<{ prd: Prd }>(await newVersionRoute.POST(req("POST"), params(v1.id))))
      .prd;
    expect([v2.version, v2.status, v2.basedOnVersion]).toEqual([2, "DRAFT", 1]);
    expect(v2.content).toEqual(approved.prd.content);
    await patch(v2.id, "summary", "Version 2 summary.");

    const v1Now = await json<{ prd: Prd }>(await prdRoute.GET(req("GET"), params(v1.id)));
    expect(v1Now.prd.content.summary).toBe("Edited summary for the dashboard.");
    expect(v1Now.prd.status).toBe("APPROVED");

    // Regenerating replaces the open draft instead of adding a version.
    await generateRoute.POST(req("POST"), params(projectId));
    s = await state(projectId);
    expect(s.versions.map((v) => [v.version, v.status, v.origin])).toEqual([
      [1, "APPROVED", "ai_edited"],
      [2, "DRAFT", "ai"],
    ]);
    expect((await approveRoute.POST(req("POST"), params(s.versions[1]!.id))).status).toBe(200);

    // Markdown export and audit trail.
    const md = await markdownRoute.GET(req("GET"), params(v1.id));
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("Edited summary for the dashboard.");
    const activity = await json<{ activity: { action: string }[] }>(
      await activityRoute.GET(req("GET"), params(projectId)),
    );
    const actions = activity.activity.map((a) => a.action);
    for (const a of ["prd.generated", "prd.updated", "prd.approved", "prd.version_created"])
      expect(actions).toContain(a);
    expect(actions.filter((a) => a === "prd.approved")).toHaveLength(2);
  });
});
