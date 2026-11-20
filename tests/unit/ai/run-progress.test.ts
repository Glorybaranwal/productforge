import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";

import type { LLMClient } from "@/src/ai/llm-client";
import { runStage } from "@/src/ai/orchestrator/run-stage";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import { createProject } from "@/src/modules/projects/service";
import { makeContext, resetDb, validProject } from "@/tests/helpers/context";

const Output = z.object({ items: z.array(z.string()).min(1) });

beforeEach(() => resetDb());

describe("runStage progress (PF-027)", () => {
  it("saves each step while the run is still going", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const seen: string[][] = [];
    const llm: LLMClient = {
      provider: "fake",
      model: "fake-1",
      async generateStructured() {
        const live = await agentRunRepository.latestForProject(ctx, project.id, "discovery");
        seen.push([live!.status, ...live!.events.map((e) => e.step)]);
        return {
          data: seen.length === 1 ? { items: [] } : { items: ["ok"] },
          usage: { tokensIn: 1, tokensOut: 1 },
          costUsd: 0,
          latencyMs: 1,
          provider: "fake",
          model: "fake-1",
        };
      },
    };

    const run = await runStage(
      {
        name: "discovery",
        promptFile: "discovery.v1.md",
        outputSchema: Output,
        loadContext: async () => ({}),
        renderPrompt: () => "prompt",
        businessRules: [],
        persist: async () => undefined,
      },
      { ctx, projectId: project.id },
      { llm, loadSystemPrompt: async () => "system" },
    );

    expect(run.status).toBe("succeeded");
    expect(seen[0]).toEqual(["running", "started", "context", "model"]);
    // The second attempt sees the failed validation and the retry already saved.
    expect(seen[1]![0]).toBe("running");
    expect(seen[1]!.slice(4)).toContain("model");
    expect(seen[1]!.length).toBeGreaterThan(seen[0]!.length + 1);
  });
});
