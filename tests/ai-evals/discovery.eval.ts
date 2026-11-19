/**
 * `pnpm eval` / `pnpm eval:quick` (EVAL_QUICK=1): runs the discovery stage on the fixtures with the
 * configured model (demo engine unless OPENAI_API_KEY is set), scores it (ADR-010) and writes a report
 * to tests/ai-evals/reports/. Fails if a blocking gate fails.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getLLMClient } from "@/src/ai/llm-client";
import { loadPrompt } from "@/src/ai/prompts/load";
import type { DiscoveryInput } from "@/src/ai/schemas/discovery";
import { discoveryRules, discoveryStage } from "@/src/ai/stages/discovery.stage";
import { zodFieldErrors } from "@/src/lib/errors";
import { DiscoveryOutput } from "@/src/modules/requirements/schema";

import { EvalFixture } from "./fixture-schema";
import { renderReport, scoreDiscovery, summarize, type FixtureScore } from "./score";

const QUICK = process.env.EVAL_QUICK === "1";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));

function loadFixtures(): EvalFixture[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${FIXTURES}${f}`, "utf8"))))
    .filter((f) => !QUICK || f.quick === true);
}

/** Same contract as the stage runner: schema + business rules, one retry with feedback. */
async function evaluate(fixture: EvalFixture, system: string): Promise<FixtureScore> {
  const llm = getLLMClient();
  // Only project and input reach the model; notes and expected never do (fixtures README).
  const input: DiscoveryInput = {
    project: { name: `Fixture ${fixture.id}`, ...fixture.project },
    sources: [{ id: "source-1", name: "Stakeholder input", text: fixture.input }],
    answers: [],
  };
  const prompt = discoveryStage.renderPrompt(input);
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await llm.generateStructured({
        name: "discovery",
        system,
        prompt,
        data: input,
        schema: DiscoveryOutput,
        feedback,
      });
      const parsed = DiscoveryOutput.safeParse(result.data);
      const problems = parsed.success
        ? discoveryRules.flatMap((rule) => rule(parsed.data, input))
        : zodFieldErrors(parsed.error).map((e) => `${e.path}: ${e.message}`);
      if (parsed.success && problems.length === 0)
        return scoreDiscovery(fixture, parsed.data, attempt, []);
      feedback = problems;
    } catch (err) {
      feedback = [String((err as Error).message)];
    }
  }
  return scoreDiscovery(fixture, null, 2, feedback ?? []);
}

describe(`discovery eval${QUICK ? " (quick)" : ""}`, () => {
  it("meets the ADR-010 blocking gates and writes a report", async () => {
    const llm = getLLMClient();
    const system = await loadPrompt(discoveryStage.promptFile);
    const scores: FixtureScore[] = [];
    for (const fixture of loadFixtures()) scores.push(await evaluate(fixture, system));

    const summary = summarize(scores);
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(REPORTS, { recursive: true });
    const file = `${REPORTS}${date}-discovery-${llm.provider}${QUICK ? "-quick" : ""}.md`;
    writeFileSync(
      file,
      renderReport(summary, scores, {
        provider: llm.provider,
        model: llm.model,
        date,
        quick: QUICK,
      }),
    );
    console.log(`Eval report: ${file}`);

    expect(summary.schemaValidRate >= 0.95).toBe(true);
    expect(summary.allHaveQuestions).toBe(true);
  }, 600_000);
});
