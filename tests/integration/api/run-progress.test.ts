import { beforeEach, describe, expect, it } from "vitest";

import * as liveRoute from "@/app/api/projects/[id]/runs/live/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { resetDb } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

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
  it("streams the steps of a run that just started", async () => {
    const { projectId } = await projectThroughGate1();
    const abort = new AbortController();
    const res = await get(projectId, "discovery", abort.signal);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    await reader.cancel();

    expect(first.startsWith("event: progress\ndata: ")).toBe(true);
    const data = JSON.parse(first.split("data: ")[1]!.split("\n")[0]!) as Record<string, string>;
    expect(data.stage).toBe("discovery");
    expect(data.step).toBe("started");
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
