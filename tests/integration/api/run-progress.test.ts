import { beforeEach, describe, expect, it } from "vitest";

import * as discoveryRoute from "@/app/api/projects/[id]/discovery/route";
import * as liveRoute from "@/app/api/projects/[id]/runs/live/route";
import * as sourcesRoute from "@/app/api/projects/[id]/sources/route";
import * as projectsRoute from "@/app/api/projects/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { resetDb, validProject } from "@/tests/helpers/context";
import { BRIEF, projectThroughGate1 } from "@/tests/helpers/discovery";

type Progress = { runId: string; stage: string; step: string; message: string; at: string };
const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Fails the test with a message instead of hanging until the global timeout. */
const within = <T>(ms: number, work: Promise<T>, what: string): Promise<T> =>
  Promise.race([
    work,
    sleep(ms).then(() => {
      throw new Error(`Timed out after ${ms} ms waiting for ${what}`);
    }),
  ]);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (projectId: string, stages: string, signal?: AbortSignal) =>
  liveRoute.GET(
    new Request(`http://localhost/api/projects/${projectId}/runs/live?stages=${stages}`, {
      signal,
    }),
    params(projectId),
  );

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("GET /api/projects/:id/runs/live (PF-027)", () => {
  it("streams the steps of a run started after the stream was opened, in order", async () => {
    // A project with a source but no discovery run yet: nothing can be replayed.
    const created = await projectsRoute.POST(json("POST", validProject));
    const { project } = (await created.json()) as { project: { id: string } };
    await sourcesRoute.POST(json("POST", { name: "Brief", text: BRIEF }), params(project.id));

    const abort = new AbortController();
    const res = await get(project.id, "discovery", abort.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const reader = res.body!.getReader();

    // Connected and idle: the run starts only now.
    let pending = reader.read();
    const idle = await Promise.race([pending, sleep(700).then(() => "idle" as const)]);
    expect(idle).toBe("idle");
    const started = discoveryRoute.POST(json("POST"), params(project.id));

    const steps: Progress[] = [];
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      while (!steps.some((p) => p.step === "succeeded" || p.step === "failed")) {
        const chunk = await within(5_000, pending, "a progress event");
        pending = reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value);
        for (const frame of buffer.split("\n\n").slice(0, -1)) {
          expect(frame.startsWith("event: progress\ndata: ")).toBe(true);
          steps.push(JSON.parse(frame.split("data: ")[1]!) as Progress);
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    } finally {
      abort.abort();
      await reader.cancel();
    }
    const run = (await (await started).json()) as { agentRunId: string; status: string };

    expect(run.status).toBe("succeeded");
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0]!.step).toBe("started");
    expect(steps.at(-1)!.step).toBe("succeeded");
    expect(new Set(steps.map((p) => p.runId))).toEqual(new Set([run.agentRunId]));
    expect(steps.every((p) => p.stage === "discovery")).toBe(true);
    const times = steps.map((p) => Date.parse(p.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("rejects unknown stages", async () => {
    const { projectId } = await projectThroughGate1();
    const res = await get(projectId, "discovery,nope");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a project outside the workspace", async () => {
    const res = await get("00000000-0000-4000-8000-000000000000", "discovery");
    expect(res.status).toBe(404);
  });
});
