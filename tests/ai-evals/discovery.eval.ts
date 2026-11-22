/**
 * `pnpm eval` / `pnpm eval:quick` (EVAL_QUICK=1): runs the discovery stage on the fixtures with the
 * configured model (demo engine unless OPENAI_API_KEY is set), scores it (ADR-010) and writes a report
 * to tests/ai-evals/reports/. Fails if a blocking gate fails.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

import { getLLMClient } from "@/src/ai/llm-client";
import type { LLMClient } from "@/src/ai/types";
import { loadPrompt } from "@/src/ai/prompts/load";
import type { DiscoveryInput } from "@/src/ai/schemas/discovery";
import { discoveryRules, discoveryStage } from "@/src/ai/stages/discovery.stage";
import { zodFieldErrors } from "@/src/lib/errors";
import { DiscoveryOutput } from "@/src/modules/requirements/schema";

import { EvalFixture } from "./fixture-schema";
import { judgeMisses } from "./judge";
import type { StoppedAt, Tier2Status } from "./report";
import {
  applyJudgeVerdicts,
  discoveryCandidates,
  renderReport,
  scoreDiscovery,
  summarize,
  type FixtureScore,
  type ItemKind,
} from "./score";
import { cappedEvalClient, isTokenCapReached, type TokenCapReached } from "./token-cap";

const QUICK = process.env.EVAL_QUICK === "1";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const JUDGE_PROMPT = fileURLToPath(new URL("./judge.v1.md", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));

function loadFixtures(): EvalFixture[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${FIXTURES}${f}`, "utf8"))))
    .filter((f) => !QUICK || f.quick === true);
}

/** ADR-010 Tier 2: one judge call per list, for the expected phrases Tier 1 missed. */
async function tier2(
  llm: LLMClient,
  judgeSystem: string,
  score: FixtureScore,
  output: DiscoveryOutput,
): Promise<FixtureScore> {
  const candidates = discoveryCandidates(output);
  let result = score;
  for (const kind of ["requirement", "question", "conflict", "ambiguity"] as ItemKind[]) {
    const misses = result.items.filter((i) => i.kind === kind && i.tier === null);
    const verdicts = await judgeMisses(
      llm,
      judgeSystem,
      misses.map((i) => i.phrase),
      candidates[kind],
    );
    result = applyJudgeVerdicts(result, kind, verdicts);
  }
  return result;
}

/** Same contract as the stage runner: schema + business rules, one retry with feedback. */
async function evaluate(
  llm: LLMClient,
  fixture: EvalFixture,
  system: string,
  judgeSystem: string | null,
): Promise<FixtureScore> {
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
      if (parsed.success && problems.length === 0) {
        const score = scoreDiscovery(fixture, parsed.data, attempt, []);
        return judgeSystem ? await tier2(llm, judgeSystem, score, parsed.data) : score;
      }
      feedback = problems;
    } catch (err) {
      // The token cap stops the whole run; it isn't a failed attempt to retry.
      if (isTokenCapReached(err)) throw err;
      feedback = [String((err as Error).message)];
    }
  }
  return scoreDiscovery(fixture, null, 2, feedback ?? []);
}

describe(`discovery eval${QUICK ? " (quick)" : ""}`, () => {
  it("meets the ADR-010 blocking gates and writes a report", async () => {
    const capped = cappedEvalClient(getLLMClient(), inject("evalUsageFile"));
    const { llm } = capped;
    const system = await loadPrompt(discoveryStage.promptFile);
    // ADR-010: Tier 2 never runs in quick runs, and the demo engine has no judge.
    const tier2Status: Tier2Status = QUICK ? "quick" : llm.provider === "demo" ? "demo" : "ran";
    const judgeSystem = tier2Status === "ran" ? readFileSync(JUDGE_PROMPT, "utf8") : null;
    const fixtures = loadFixtures();
    const scores: FixtureScore[] = [];
    let capReached: TokenCapReached | null = null;
    for (const fixture of fixtures) {
      try {
        scores.push(await evaluate(llm, fixture, system, judgeSystem));
      } catch (err) {
        if (!isTokenCapReached(err)) throw err;
        capReached = err; // ADR-010 cost guard: stop, report what ran, then fail
        break;
      }
    }
    const stopped: StoppedAt | null = capReached
      ? { done: scores.length, total: fixtures.length }
      : null;

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
        tier2: tier2Status,
        tokens: capped.tokens(),
        stopped,
      }),
    );
    console.log(`Eval report: ${file}`);
    if (capReached) throw capReached;

    expect(summary.schemaValidRate >= 0.95).toBe(true);
    expect(summary.allHaveQuestions).toBe(true);
  }, 600_000);
});
