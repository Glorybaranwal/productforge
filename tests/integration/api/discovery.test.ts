import { beforeEach, describe, expect, it } from "vitest";

import * as runRoute from "@/app/api/agent-runs/[id]/route";
import * as confirmRoute from "@/app/api/projects/[id]/discovery/confirm/route";
import * as discoveryRoute from "@/app/api/projects/[id]/discovery/route";
import * as addRequirementRoute from "@/app/api/projects/[id]/requirements/route";
import * as sourcesRoute from "@/app/api/projects/[id]/sources/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as questionRoute from "@/app/api/questions/[id]/route";
import * as requirementRoute from "@/app/api/requirements/[id]/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { DiscoveryState } from "@/src/modules/requirements/discovery-service";
import { resetDb, validProject } from "@/tests/helpers/context";

const URL_BASE = "http://localhost/api";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_BASE, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const BRIEF =
  "Build a transaction monitoring dashboard where customers can view transactions, filter them, " +
  "download reports, and receive notifications for failed transactions. It must be really fast.";

beforeEach(() => {
  resetDb();
  setLLMClient(undefined); // demo engine
});

async function setup() {
  const created = await json<{ project: { id: string } }>(
    await projectsRoute.POST(req("POST", validProject)),
  );
  return created.project.id;
}

describe("discovery & clarification (Gate 1)", () => {
  it("refuses to run without sources", async () => {
    const projectId = await setup();
    const res = await discoveryRoute.POST(req("POST"), params(projectId));
    expect(res.status).toBe(400);
  });

  it("runs end to end: sources → run → answer → re-run → edit → confirm", async () => {
    const projectId = await setup();
    const added = await sourcesRoute.POST(
      req("POST", { name: "Kickoff notes", text: BRIEF }),
      params(projectId),
    );
    expect(added.status).toBe(201);

    // First run, with an idempotency key; a replay returns the same run.
    const headers = { "idempotency-key": "run-1" };
    const first = await json<{ agentRunId: string; status: string; replayed: boolean }>(
      await discoveryRoute.POST(req("POST", undefined, headers), params(projectId)),
    );
    expect(first.status).toBe("succeeded");
    const replay = await json<{ agentRunId: string; replayed: boolean }>(
      await discoveryRoute.POST(req("POST", undefined, headers), params(projectId)),
    );
    expect(replay.agentRunId).toBe(first.agentRunId);
    expect(replay.replayed).toBe(true);

    let state = await json<DiscoveryState>(await discoveryRoute.GET(req("GET"), params(projectId)));
    expect(state.requirements.length > 3).toBe(true);
    expect(state.requirements.every((r) => r.status === "DRAFT" && r.code.length > 0)).toBe(true);
    expect(state.discovery?.ambiguities.map((a) => a.term)).toContain("really fast");
    expect(state.blockers[0]).toContain("open question");

    // Gate 1 is blocked while questions are open.
    expect((await confirmRoute.POST(req("POST"), params(projectId))).status).toBe(409);

    // Answer the channel question, assume one, skip the rest.
    const [channel, ...rest] = [
      ...state.questions.filter((q) => /channel/i.test(q.question)),
      ...state.questions.filter((q) => !/channel/i.test(q.question)),
    ];
    const answered = await questionRoute.PATCH(
      req("PATCH", { state: "answered", answer: "Email and push" }),
      params(channel!.id),
    );
    expect(answered.status).toBe(200);
    await questionRoute.PATCH(
      req("PATCH", { state: "assumption", answer: "Customers use the web app" }),
      params(rest[0]!.id),
    );
    for (const q of rest.slice(1))
      await questionRoute.PATCH(req("PATCH", { state: "skipped" }), params(q.id));
    const invalid = await questionRoute.PATCH(
      req("PATCH", { state: "answered", answer: "" }),
      params(channel!.id),
    );
    expect(invalid.status).toBe(400);

    // Edit one requirement and reject another before re-running: both decisions must survive.
    const [toEdit, toReject] = state.requirements;
    await requirementRoute.PATCH(
      req("PATCH", { text: "Customers can view their transaction history" }),
      params(toEdit!.id),
    );
    await requirementRoute.PATCH(req("PATCH", { status: "REJECTED" }), params(toReject!.id));

    const rerun = await json<{ status: string }>(
      await discoveryRoute.POST(req("POST"), params(projectId)),
    );
    expect(rerun.status).toBe("succeeded");
    state = await json<DiscoveryState>(await discoveryRoute.GET(req("GET"), params(projectId)));
    expect(state.discovery?.runCount).toBe(2);

    const edited = state.requirements.find((r) => r.id === toEdit!.id);
    expect(edited?.origin).toBe("ai_edited");
    expect(state.requirements.find((r) => r.id === toReject!.id)?.status).toBe("REJECTED");
    expect(state.requirements.filter((r) => r.text === toReject!.text)).toHaveLength(1);
    const fromAnswer = state.requirements.find((r) => r.sourceId === "answers");
    expect(fromAnswer?.text).toContain("Email and push");
    expect(
      state.requirements.some((r) => r.evidence === "ASSUMPTION" && r.text.includes("web app")),
    ).toBe(true);

    // Resolve anything the re-run asked, add a manual requirement, then pass Gate 1.
    for (const q of state.questions.filter((q) => q.state === "open")) {
      await questionRoute.PATCH(req("PATCH", { state: "skipped" }), params(q.id));
    }
    const manual = await addRequirementRoute.POST(
      req("POST", { text: "Export approved items to Jira", type: "functional" }),
      params(projectId),
    );
    expect(manual.status).toBe(201);

    const confirmed = await confirmRoute.POST(req("POST"), params(projectId));
    expect(confirmed.status).toBe(200);
    state = await json<DiscoveryState>(confirmed);
    expect(state.discovery?.status).toBe("confirmed");
    const live = state.requirements.filter((r) => r.status !== "REJECTED");
    expect(live.every((r) => r.status === "APPROVED" && r.approvedAt !== null)).toBe(true);

    // After Gate 1: no in-place edits and no re-runs.
    expect(
      (
        await requirementRoute.PATCH(
          req("PATCH", { text: "Changed after approval" }),
          params(live[0]!.id),
        )
      ).status,
    ).toBe(409);
    expect((await discoveryRoute.POST(req("POST"), params(projectId))).status).toBe(409);

    // The run is logged with its steps.
    const run = await json<{ run: { status: string; events: { step: string }[] } }>(
      await runRoute.GET(req("GET"), params(first.agentRunId)),
    );
    expect(run.run.status).toBe("succeeded");
    expect(run.run.events.some((e) => e.step === "validate")).toBe(true);
  });
});
