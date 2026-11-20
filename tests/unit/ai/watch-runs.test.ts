import { describe, expect, it } from "vitest";

import { watchRuns, type RunProgress } from "@/src/ai/orchestrator/watch-runs";
import type { AgentRun } from "@/src/modules/agent-runs/schema";

const at = "2026-11-20T10:00:00.000Z";
const since = Date.parse(at) - 1_000;

function run(id: string, steps: string[], createdAt = at): AgentRun {
  return {
    id,
    stage: "discovery",
    createdAt,
    events: steps.map((message, i) => ({ at, step: i ? "model" : "started", message })),
  } as AgentRun;
}

/** Feeds `frames` to the watcher, one per poll, then closes. */
async function watch(frames: (AgentRun | null)[][]) {
  const sent: RunProgress[] = [];
  let polls = 0;
  await watchRuns({
    since,
    load: async () => frames[polls++] ?? [],
    send: (p) => sent.push(p),
    isClosed: () => polls >= frames.length,
    sleep: async () => undefined,
  });
  return sent;
}

describe("watchRuns", () => {
  it("sends each step once, as it appears", async () => {
    const sent = await watch([
      [run("r1", ["a"])],
      [run("r1", ["a", "b"])],
      [run("r1", ["a", "b", "c"])],
    ]);
    expect(sent.map((p) => p.message)).toEqual(["a", "b", "c"]);
    expect(sent[0]).toMatchObject({ runId: "r1", stage: "discovery", step: "started" });
  });

  it("ignores runs that started before the page asked", async () => {
    const old = run("r0", ["old"], "2026-11-20T09:00:00.000Z");
    const sent = await watch([
      [old, null],
      [old, run("r2", ["new"])],
    ]);
    expect(sent.map((p) => p.message)).toEqual(["new"]);
  });

  it("follows several stages at once", async () => {
    const sent = await watch([[run("s", ["story"]), run("q", ["qa"])]]);
    expect(sent.map((p) => p.runId)).toEqual(["s", "q"]);
  });

  it("stops at the timeout even if the client stays", async () => {
    let polls = 0;
    await watchRuns({
      since,
      load: async () => (polls++, []),
      send: () => undefined,
      isClosed: () => false,
      sleep: async () => undefined,
      timeoutMs: -1,
    });
    expect(polls).toBe(0);
  });
});
