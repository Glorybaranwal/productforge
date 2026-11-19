import type { QaInput, StoryInput, TaskInput } from "@/src/ai/schemas/backlog";
import type { DiscoveryInput } from "@/src/ai/schemas/discovery";
import type { ImpactInput } from "@/src/ai/schemas/impact";
import type { PrdInput } from "@/src/ai/schemas/prd";

import { estimateTokens, LLMError, type LLMClient } from "../types";
import { runDemoDiscovery } from "./discovery-engine";
import { runDemoImpact } from "./impact-engine";
import { runDemoPrd } from "./prd-engine";
import { runDemoQa } from "./qa-engine";
import { runDemoStories } from "./story-engine";
import { runDemoTasks } from "./task-engine";

export const DEMO_MODEL = "demo-engine-v1";

const RESPONDERS: Record<string, (data: unknown) => unknown> = {
  discovery: (data) => runDemoDiscovery(data as DiscoveryInput),
  prd: (data) => runDemoPrd(data as PrdInput),
  story: (data) => runDemoStories(data as StoryInput),
  qa: (data) => runDemoQa(data as QaInput),
  task: (data) => runDemoTasks(data as TaskInput),
  impact: (data) => runDemoImpact(data as ImpactInput),
};

/** Deterministic, free, offline stand-in for a model (ADR-011). Same interface as OpenAI. */
export function createDemoClient(): LLMClient {
  return {
    provider: "demo",
    model: DEMO_MODEL,
    async generateStructured(request) {
      const started = Date.now();
      const responder = RESPONDERS[request.name];
      if (!responder)
        throw new LLMError(`The demo engine can't run the "${request.name}" stage yet`);
      const data = responder(request.data);
      return {
        data,
        usage: {
          tokensIn: estimateTokens(request.system + request.prompt),
          tokensOut: estimateTokens(JSON.stringify(data)),
        },
        costUsd: 0,
        latencyMs: Date.now() - started,
        provider: "demo",
        model: DEMO_MODEL,
      };
    },
  };
}
