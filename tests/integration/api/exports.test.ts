import { beforeEach, describe, expect, it } from "vitest";

import * as generateRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as backlogMarkdownRoute from "@/app/api/projects/[id]/backlog/markdown/route";
import * as backlogRoute from "@/app/api/projects/[id]/backlog/route";
import * as jiraRoute from "@/app/api/projects/[id]/exports/jira/route";
import * as exportsRoute from "@/app/api/projects/[id]/exports/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as traceCsvRoute from "@/app/api/projects/[id]/traceability/csv/route";
import * as prdMarkdownRoute from "@/app/api/prds/[id]/markdown/route";
import * as approveRoute from "@/app/api/stories/[id]/approve/route";
import * as storyRoute from "@/app/api/stories/[id]/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { ExportOverview } from "@/src/modules/exports/service";
import type { PrdState } from "@/src/modules/prd/service";
import type { BacklogState } from "@/src/modules/stories/state";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { resetDb } from "@/tests/helpers/context";
import { checkJiraCsv, parseCsv } from "@/tests/helpers/jira-csv-check";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const overview = async (projectId: string) =>
  (await (await exportsRoute.GET(req("GET"), params(projectId))).json()) as ExportOverview;
const exportJira = (projectId: string, body: unknown) =>
  jiraRoute.POST(req("POST", body), params(projectId));

/** Project with a generated backlog where only the first `n` stories are approved. */
async function withApproved(n: number) {
  const { projectId } = await projectThroughGate2();
  await generateRoute.POST(req("POST"), params(projectId));
  const state = (await (
    await backlogRoute.GET(req("GET"), params(projectId))
  ).json()) as BacklogState;
  const stories = state.stories.slice(0, n);
  for (const s of stories) await approveRoute.POST(req("POST"), params(s.id));
  return { projectId, state, approved: stories };
}

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("Jira export (PF-050)", () => {
  it("has nothing to export until a story is approved", async () => {
    const { projectId } = await withApproved(0);
    const o = await overview(projectId);
    expect(o.plan.counts.stories).toBe(0);
    expect(o.plan.excluded.drafts.length).toBeGreaterThan(0);
    const res = await exportJira(projectId, { format: "csv" });
    expect(res.status).toBe(409);
  });

  it("exports approved stories only, parents first, valid for Jira Cloud", async () => {
    const { projectId, state, approved } = await withApproved(3);
    const o = await overview(projectId);
    expect(o.plan.counts.stories).toBe(3);
    expect(
      o.plan.items
        .filter((i) => i.level === "story")
        .map((i) => i.ref)
        .sort(),
    ).toEqual(approved.map((s) => s.code).sort());
    expect(o.plan.warnings[0]).toContain(`${state.stories.length - 3} draft stories are left out`);

    const res = await exportJira(projectId, { format: "csv", target: "cloud" });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("-jira-cloud.csv");
    const csv = await res.text();
    expect(checkJiraCsv(csv, "cloud")).toEqual([]);
    const [header, ...rows] = parseCsv(csv);
    expect(header!.slice(0, 8)).toEqual([
      "Issue ID",
      "Parent",
      "Issue Type",
      "Summary",
      "Description",
      "Priority",
      "Story Points",
      "Original Estimate",
    ]);
    expect(header!.filter((h) => h === "Labels").length).toBeGreaterThan(1);
    const story = rows.find((r) => r[2] === "Story")!;
    expect(story[4]).toContain("Acceptance criteria\n\n1. Positive: Given");
    expect(story[4]).toContain("Source: ProductForge AI · ");
    expect(["High", "Medium", "Low"]).toContain(story[5]);
    expect(story).toContain("productforge");
    const sub = rows.find((r) => r[2] === "Sub-task")!;
    expect(Number(sub[7]) % 1800).toBe(0); // hours → seconds
    expect(rows.length).toBe(o.plan.items.length);
  });

  it("writes Epic Name / Epic Link for Jira Data Center, and honours the options", async () => {
    const { projectId } = await withApproved(4);
    const dc = await (
      await exportJira(projectId, { target: "datacenter", subtaskType: "Subtask" })
    ).text();
    expect(checkJiraCsv(dc, "datacenter", "Subtask")).toEqual([]);
    expect(parseCsv(dc)[0]!.slice(0, 4)).toEqual([
      "Issue Id",
      "Parent Id",
      "Epic Name",
      "Epic Link",
    ]);
    const noTasks = await (await exportJira(projectId, { includeTasks: false })).text();
    expect(parseCsv(noTasks).some((r) => r[2] === "Sub-task")).toBe(false);
    expect((await exportJira(projectId, { subtaskType: " " })).status).toBe(400);
    expect((await exportJira(projectId, { format: "xml" })).status).toBe(400);
  });

  it("exports JSON in Jira REST shapes, nested epic → story → sub-task", async () => {
    const { projectId } = await withApproved(2);
    const res = await exportJira(projectId, { format: "json" });
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as {
      format: string;
      epics: {
        ref: string;
        fields: { issuetype: { name: string }; description: { type: string; version: number } };
        stories: {
          fields: {
            priority: { name: string };
            labels: string[];
            description: { content: { type: string }[] };
          };
          storyPoints: number;
          subtasks: { fields: { timetracking: { originalEstimate: string } } }[];
        }[];
      }[];
      notes: string[];
    };
    expect(json.format).toBe("productforge.jira-export/v1");
    const epic = json.epics[0]!;
    expect([
      epic.fields.issuetype.name,
      epic.fields.description.type,
      epic.fields.description.version,
    ]).toEqual(["Epic", "doc", 1]);
    const story = json.epics.flatMap((e) => e.stories)[0]!;
    expect(story.fields.description.content.map((n) => n.type)).toContain("orderedList");
    expect(story.storyPoints).toBeGreaterThan(0);
    expect(story.subtasks[0]!.fields.timetracking.originalEstimate).toMatch(
      /^\d+h( \d+m)?$|^\d+m$/,
    );
    expect(json.notes.join(" ")).toContain("fields.parent");
  });

  it("keeps awkward text intact and formula-safe", async () => {
    const { projectId, state } = await withApproved(0);
    const s = state.stories[0]!;
    const title = '=SUM(1,2) "quoted", with a\nnew line';
    await storyRoute.PATCH(
      req("PATCH", {
        section: "story",
        value: {
          epicId: s.epicId,
          title,
          asA: s.asA,
          iWant: s.iWant,
          soThat: s.soThat,
          priority: s.priority,
          storyPoints: s.storyPoints,
          requirementCodes: s.requirementCodes,
          dependsOn: s.dependsOn,
        },
      }),
      params(s.id),
    );
    await approveRoute.POST(req("POST"), params(s.id));
    const csv = await (await exportJira(projectId, {})).text();
    expect(checkJiraCsv(csv, "cloud")).toEqual([]);
    const story = parseCsv(csv).find((r) => r[2] === "Story")!;
    expect(story[3]).toBe(`'${title}`);
  });

  it("logs every export — Jira, PRD and backlog Markdown, traceability CSV — and lists them", async () => {
    const { projectId } = await withApproved(2);
    await exportJira(projectId, { format: "csv" });
    await exportJira(projectId, { format: "json", target: "datacenter" });
    const prd = (await (await prdStateRoute.GET(req("GET"), params(projectId))).json()) as PrdState;
    await prdMarkdownRoute.GET(req("GET"), params(prd.versions[0]!.id));
    await backlogMarkdownRoute.GET(req("GET"), params(projectId));
    await traceCsvRoute.GET(req("GET"), params(projectId));
    const { history } = await overview(projectId);
    expect(history.map((h) => h.what)).toEqual([
      "Traceability CSV",
      "Backlog Markdown",
      "PRD Markdown",
      "Jira JSON (Jira Data Center)",
      "Jira CSV (Jira Cloud)",
    ]);
    expect(history[4]!.detail).toMatch(/^2 stories, \d+ sub-tasks$/);
    expect(history[0]!.actor).toBe("Demo PM");
  });
});
