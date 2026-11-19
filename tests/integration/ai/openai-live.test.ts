import { describe, expect, it } from "vitest";

import { createOpenAIClient } from "@/src/ai/openai-client";
import { loadPrompt } from "@/src/ai/prompts/load";
import type { DiscoveryInput } from "@/src/ai/schemas/discovery";
import { discoveryRules, discoveryStage } from "@/src/ai/stages/discovery.stage";
import { DiscoveryOutput } from "@/src/modules/requirements/schema";

const LIVE = process.env.RUN_LIVE_LLM_TESTS === "true" && Boolean(process.env.OPENAI_API_KEY);

/** PF-020 live smoke test: costs a few cents. Run with RUN_LIVE_LLM_TESTS=true and OPENAI_API_KEY set. */
describe.skipIf(!LIVE)("OpenAI live smoke test", () => {
  it("returns schema-valid discovery output that passes the business rules", async () => {
    const client = createOpenAIClient({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL,
    });
    const input: DiscoveryInput = {
      project: { name: "Smoke test", domain: "Fintech", audience: "retail customers", teamSize: 4 },
      sources: [
        {
          id: "s1",
          name: "Brief",
          text: "Customers can view and filter their transactions. It must be fast.",
        },
      ],
      answers: [],
    };
    const result = await client.generateStructured({
      name: "discovery",
      system: await loadPrompt(discoveryStage.promptFile),
      prompt: discoveryStage.renderPrompt(input),
      data: input,
      schema: DiscoveryOutput,
    });
    const parsed = DiscoveryOutput.parse(result.data);
    expect(discoveryRules.flatMap((rule) => rule(parsed, input))).toEqual([]);
    expect(result.usage.tokensIn > 0).toBe(true);
  }, 90_000);
});
