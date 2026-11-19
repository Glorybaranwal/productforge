import { z } from "zod";
import { beforeEach, describe, expect, it } from "vitest";

import { LLMError, type LLMClient, type StructuredRequest } from "@/src/ai/llm-client";
import { runStage, type Stage } from "@/src/ai/orchestrator/run-stage";
import { createProject } from "@/src/modules/projects/service";
import { makeContext, resetDb, validProject } from "@/tests/helpers/context";

const Output = z.object({ items: z.array(z.string()).min(1) });
type Output = z.infer<typeof Output>;

/** A fake model that returns the given responses in order and records each request. */
function fakeLLM(responses: (unknown | Error)[]) {
  const requests: StructuredRequest<z.ZodType>[] = [];
  const client: LLMClient = {
    provider: "fake",
    model: "fake-1",
    async generateStructured(request) {
      requests.push(request);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return {
        data: next,
        usage: { tokensIn: 10, tokensOut: 5 },
        costUsd: 0.001,
        latencyMs: 3,
        provider: "fake",
        model: "fake-1",
      };
    },
  };
  return { client, requests };
}

function makeStage(saved: Output[]): Stage<{ topic: string }, Output> {
  return {
    name: "discovery",
    promptFile: "discovery.v1.md",
    outputSchema: Output,
    loadContext: async () => ({ topic: "payments" }),
    renderPrompt: (input) => `Topic: ${input.topic}`,
    businessRules: [
      (o) => (o.items.includes("forbidden") ? ["items: 'forbidden' is not allowed"] : []),
    ],
    persist: async (output) => {
      saved.push(output);
    },
  };
}

const deps = (client: LLMClient) => ({
  llm: client,
  loadSystemPrompt: async () => "system prompt",
});

beforeEach(() => resetDb());

describe("runStage", () => {
  it("validates, persists and logs a successful run", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const saved: Output[] = [];
    const { client } = fakeLLM([{ items: ["a"] }]);

    const run = await runStage(makeStage(saved), { ctx, projectId: project.id }, deps(client));

    expect(run.status).toBe("succeeded");
    expect(run.attempts).toBe(1);
    expect(saved).toEqual([{ items: ["a"] }]);
    expect(run.tokensIn).toBe(10);
    expect(run.events.map((e) => e.step)).toEqual([
      "started",
      "context",
      "model",
      "validate",
      "persist",
      "succeeded",
    ]);
    expect(run.inputHash).toHaveLength(64);
  });

  it("retries once with the validation errors, then succeeds", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const saved: Output[] = [];
    const { client, requests } = fakeLLM([{ items: [] }, { items: ["ok"] }]);

    const run = await runStage(makeStage(saved), { ctx, projectId: project.id }, deps(client));

    expect(run.status).toBe("succeeded");
    expect(run.attempts).toBe(2);
    expect(requests[1]?.feedback?.[0]).toContain("items");
    expect(run.tokensIn).toBe(20);
    expect(saved).toHaveLength(1);
  });

  it("fails after two invalid outputs and saves nothing", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const saved: Output[] = [];
    const { client } = fakeLLM([{ items: ["forbidden"] }, { wrong: true }]);

    const run = await runStage(makeStage(saved), { ctx, projectId: project.id }, deps(client));

    expect(run.status).toBe("failed");
    expect(run.error).toContain("failed validation twice");
    expect(saved).toEqual([]);
  });

  it("records a provider error as a failed run", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const { client } = fakeLLM([new LLMError("The model took too long to respond", true)]);

    const run = await runStage(makeStage([]), { ctx, projectId: project.id }, deps(client));

    expect(run.status).toBe("failed");
    expect(run.error).toBe("The model took too long to respond");
    expect(run.finishedAt === null).toBe(false);
  });
});
