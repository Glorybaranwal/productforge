import { beforeEach, describe, expect, it } from "vitest";

import * as activityRoute from "@/app/api/projects/[id]/activity/route";
import * as approveAllRoute from "@/app/api/projects/[id]/backlog/approve/route";
import * as generateRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as markdownRoute from "@/app/api/projects/[id]/backlog/markdown/route";
import * as backlogRoute from "@/app/api/projects/[id]/backlog/route";
import * as addStoryRoute from "@/app/api/projects/[id]/stories/route";
import * as approveRoute from "@/app/api/stories/[id]/approve/route";
import * as newVersionRoute from "@/app/api/stories/[id]/new-version/route";
import * as regenerateRoute from "@/app/api/stories/[id]/regenerate/route";
import * as rejectRoute from "@/app/api/stories/[id]/reject/route";
import * as restoreRoute from "@/app/api/stories/[id]/restore/route";
import * as storyRoute from "@/app/api/stories/[id]/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { AuditLog } from "@/src/modules/audit/schema";
import type { Story } from "@/src/modules/stories/schema";
import type { BacklogState } from "@/src/modules/stories/state";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { resetDb } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T>(res: Response) => (await res.json()) as T;
const state = async (projectId: string) =>
  json<BacklogState>(await backlogRoute.GET(req("GET"), params(projectId)));
type Pipeline = { status: string; runs: { stage: string; status: string }[]; replayed: boolean };

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("Backlog: stories, criteria, tasks (Gate 3)", () => {
  it("is locked until the PRD is approved", async () => {
    const { projectId } = await projectThroughGate1();
    expect((await generateRoute.POST(req("POST"), params(projectId))).status).toBe(409);
    expect((await state(projectId)).gate2Passed).toBe(false);
  });

  it("generates a traced backlog, then only fills gaps", async () => {
    const { projectId } = await projectThroughGate2();
    const key = { "Idempotency-Key": "k-1" };
    const out = await json<Pipeline>(
      await generateRoute.POST(req("POST", undefined, key), params(projectId)),
    );
    expect(out.status).toBe("succeeded");
    expect(out.runs.map((r) => r.stage)).toEqual(["story", "qa", "task"]);
    const replay = await json<Pipeline>(
      await generateRoute.POST(req("POST", undefined, key), params(projectId)),
    );
    expect(replay.replayed).toBe(true);

    const s = await state(projectId);
    expect(s.stories.length).toBeGreaterThan(2);
    expect(s.coverage.uncovered).toEqual([]);
    expect(s.coverage.waiting.length).toBe(1); // the open question about business accounts
    for (const story of s.stories) {
      expect(story.requirementCodes.length).toBeGreaterThan(0);
      expect(story.criteria.length).toBeGreaterThanOrEqual(2);
      expect(story.criteria.some((c) => c.kind !== "positive")).toBe(true);
      expect(story.tasks.length).toBeGreaterThan(0);
      expect(story.storyPoints).not.toBeNull();
      expect([story.status, story.origin, story.version]).toEqual(["DRAFT", "ai", 1]);
    }
    expect(s.pending).toEqual({ stories: 0, criteria: 0, tasks: 0 });
    const again = await json<Pipeline>(await generateRoute.POST(req("POST"), params(projectId)));
    expect(again.status).toBe("nothing_to_do");
  });

  it("edits, approves, rejects, regenerates with a note, versions and exports", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    let s = await state(projectId);
    const [first, second] = s.stories.filter((x) =>
      x.requirementCodes.some((c) => c.startsWith("FR-")),
    );
    if (!first || !second) throw new Error("need two functional stories");

    // Autosave the story section: origin becomes ai_edited; bad links are refused.
    const fields = {
      epicId: first.epicId,
      title: first.title,
      asA: first.asA,
      iWant: first.iWant,
      soThat: "I can find a payment in under 30 seconds",
      priority: first.priority,
      storyPoints: 3,
      requirementCodes: first.requirementCodes,
      dependsOn: [],
    };
    expect(
      (await storyRoute.PATCH(req("PATCH", { section: "story", value: fields }), params(first.id)))
        .status,
    ).toBe(200);
    const bad = await storyRoute.PATCH(
      req("PATCH", { section: "story", value: { ...fields, requirementCodes: ["FR-99"] } }),
      params(first.id),
    );
    expect(bad.status).toBe(400);
    const cycle = await storyRoute.PATCH(
      req("PATCH", { section: "story", value: { ...fields, dependsOn: [first.code] } }),
      params(first.id),
    );
    expect(cycle.status).toBe(400);

    // Criteria: dropping the negative/edge cases blocks approval.
    const positives = first.criteria.filter((c) => c.kind === "positive").slice(0, 2);
    const onlyPositive = [
      ...positives,
      { ...positives[0]!, id: crypto.randomUUID(), then: "the list shows 20 rows per page" },
    ].map(({ id, kind, given, when, then }) => ({ id, kind, given, when, then }));
    await storyRoute.PATCH(
      req("PATCH", { section: "criteria", value: onlyPositive }),
      params(first.id),
    );
    s = await state(projectId);
    const edited = s.stories.find((x) => x.id === first.id)!;
    expect(edited.origin).toBe("ai_edited");
    expect(edited.blockers.join(" ")).toContain("negative or edge-case");
    expect((await approveRoute.POST(req("POST"), params(first.id))).status).toBe(409);

    // Put the original criteria back, add a task, approve.
    const original = first.criteria.map(({ id, kind, given, when, then }) => ({
      id,
      kind,
      given,
      when,
      then,
    }));
    await storyRoute.PATCH(
      req("PATCH", { section: "criteria", value: original }),
      params(first.id),
    );
    const tasks = [
      ...first.tasks.map(({ id, title, description, estimateHours }) => ({
        id,
        title,
        description,
        estimateHours,
      })),
      {
        id: crypto.randomUUID(),
        title: "Docs: update the help page",
        description: "",
        estimateHours: 1,
      },
    ];
    await storyRoute.PATCH(req("PATCH", { section: "tasks", value: tasks }), params(first.id));
    const approved = await json<{ story: Story }>(
      await approveRoute.POST(req("POST"), params(first.id)),
    );
    expect(approved.story.status).toBe("APPROVED");
    expect(
      (await storyRoute.PATCH(req("PATCH", { section: "story", value: fields }), params(first.id)))
        .status,
    ).toBe(409);

    // Reject the second story: its requirement becomes uncovered; regenerate with a note restores it.
    expect((await rejectRoute.POST(req("POST", { reason: "" }), params(second.id))).status).toBe(
      400,
    );
    await rejectRoute.POST(req("POST", { reason: "Wrong persona" }), params(second.id));
    s = await state(projectId);
    expect(s.coverage.uncovered).toEqual(expect.arrayContaining([second.requirementCodes[0]!]));
    expect((await restoreRoute.POST(req("POST"), params(second.id))).status).toBe(200);
    await rejectRoute.POST(req("POST", { reason: "Wrong persona" }), params(second.id));
    const regen = await json<Pipeline>(
      await regenerateRoute.POST(
        req("POST", { note: "Write it as a support agent. Priority should-have." }),
        params(second.id),
      ),
    );
    expect(regen.runs.map((r) => `${r.stage}:${r.status}`)).toEqual([
      "story:succeeded",
      "qa:succeeded",
      "task:succeeded",
    ]);
    s = await state(projectId);
    const rewritten = s.stories.find((x) => x.id === second.id)!;
    expect([rewritten.status, rewritten.asA, rewritten.priority]).toEqual([
      "DRAFT",
      "support agent",
      "should",
    ]);
    expect(rewritten.rationale).toContain("Applied: persona → support agent, priority → should");
    expect(rewritten.criteria.length).toBeGreaterThanOrEqual(2);
    expect(s.coverage.uncovered).toEqual([]);

    // Approve the rest; Gate 3 passes; only approved stories export.
    const bulk = await json<{ approved: string[] }>(
      await approveAllRoute.POST(req("POST"), params(projectId)),
    );
    expect(bulk.approved.length).toBe(s.stories.length - 1);
    s = await state(projectId);
    expect(s.gate3).toEqual({ passed: true, blockers: [] });
    const md = await (await markdownRoute.GET(req("GET"), params(projectId))).text();
    expect(md).toContain(`### ${first.code} · `);
    expect(md).toContain("**Given**");

    // Editing an approved story starts version 2; v1 stays approved; Gate 3 reopens.
    const v2 = (
      await json<{ story: Story }>(await newVersionRoute.POST(req("POST"), params(first.id)))
    ).story;
    expect([v2.code, v2.version, v2.status, v2.basedOnVersion]).toEqual([
      first.code,
      2,
      "DRAFT",
      1,
    ]);
    s = await state(projectId);
    const current = s.stories.find((x) => x.code === first.code)!;
    expect([current.id, current.versions, current.criteria.length]).toEqual([
      v2.id,
      2,
      first.criteria.length,
    ]);
    expect(s.gate3.passed).toBe(false);
    expect((await storyRoute.GET(req("GET"), params(first.id))).status).toBe(200);
    expect((await approveRoute.POST(req("POST"), params(first.id))).status).toBe(409); // old version

    const { activity } = await json<{ activity: AuditLog[] }>(
      await activityRoute.GET(req("GET"), params(projectId)),
    );
    const actions = activity.map((a) => a.action);
    for (const a of [
      "backlog.generated",
      "story.updated",
      "story.approved",
      "story.rejected",
      "story.restored",
      "story.regenerated",
      "backlog.bulk_approved",
      "story.version_created",
    ]) {
      expect(actions).toContain(a);
    }
  });

  it("adds a story by hand and fills its criteria and tasks", async () => {
    const { projectId } = await projectThroughGate2();
    await generateRoute.POST(req("POST"), params(projectId));
    const s = await state(projectId);
    const epic = s.epics[0]!;
    const missing = await addStoryRoute.POST(
      req("POST", { epicId: epic.id, title: "x" }),
      params(projectId),
    );
    expect(missing.status).toBe(400);
    const res = await addStoryRoute.POST(
      req("POST", {
        epicId: epic.id,
        title: "Export transactions to CSV",
        asA: "customer",
        iWant: "to export my transactions to CSV",
        soThat: "I can do my own budgeting",
        priority: "could",
        requirementCodes: ["FR-03"],
      }),
      params(projectId),
    );
    expect(res.status).toBe(201);
    const { story } = await json<{ story: Story }>(res);
    expect([story.origin, story.evidence, story.status]).toEqual(["human", "EXPLICIT", "DRAFT"]);
    expect((await state(projectId)).pending).toEqual({ stories: 0, criteria: 1, tasks: 1 });
    const fill = await json<Pipeline>(await generateRoute.POST(req("POST"), params(projectId)));
    expect(fill.runs.map((r) => r.stage)).toEqual(["qa", "task"]);
    const filled = (await state(projectId)).stories.find((x) => x.id === story.id)!;
    expect(filled.criteria.length).toBeGreaterThanOrEqual(2);
    expect(filled.tasks.length).toBeGreaterThan(0);
  });
});
