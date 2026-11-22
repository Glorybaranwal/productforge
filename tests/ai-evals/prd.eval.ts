/**
 * PRD eval (PF-030 "Done when: PRD generated for 5 fixtures, all schema-valid"). Runs on the quick set.
 * Input comes from the deterministic demo discovery, so the score isolates the PRD stage.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

import { getLLMClient } from "@/src/ai/llm-client";
import { loadPrompt } from "@/src/ai/prompts/load";
import { prdRules, prdStage } from "@/src/ai/stages/prd.stage";
import { zodFieldErrors } from "@/src/lib/errors";
import { linkedCodes, PrdContent } from "@/src/modules/prd/schema";
import { prdInputFor } from "@/tests/helpers/prd-input";

import { EvalFixture } from "./fixture-schema";
import { cappedEvalClient } from "./token-cap";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));

type Row = {
  id: string;
  valid: boolean;
  attempts: number;
  functional: number;
  nonFunctional: number;
  coverage: string;
  problems: string[];
};

describe("PRD eval (quick set)", () => {
  it("produces a schema-valid, fully traced PRD for every quick fixture", async () => {
    const { llm } = cappedEvalClient(getLLMClient(), inject("evalUsageFile"));
    const system = await loadPrompt(prdStage.promptFile);
    const fixtures = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${FIXTURES}${f}`, "utf8"))))
      .filter((f) => f.quick);

    const rows: Row[] = [];
    for (const fixture of fixtures) {
      const input = prdInputFor(fixture);
      let feedback: string[] | undefined;
      let row: Row = {
        id: fixture.id,
        valid: false,
        attempts: 2,
        functional: 0,
        nonFunctional: 0,
        coverage: "–",
        problems: [],
      };
      for (let attempt = 1; attempt <= 2; attempt++) {
        const result = await llm.generateStructured({
          name: "prd",
          system,
          prompt: prdStage.renderPrompt(input),
          data: input,
          schema: PrdContent,
          feedback,
        });
        const parsed = PrdContent.safeParse(result.data);
        const problems = parsed.success
          ? prdRules.flatMap((rule) => rule(parsed.data, input))
          : zodFieldErrors(parsed.error).map((e) => `${e.path}: ${e.message}`);
        if (parsed.success && problems.length === 0) {
          const linked = linkedCodes(parsed.data);
          const covered = input.requirements.filter((r) => linked.has(r.code)).length;
          row = {
            id: fixture.id,
            valid: true,
            attempts: attempt,
            functional: parsed.data.functionalRequirements.length,
            nonFunctional: parsed.data.nonFunctionalRequirements.length,
            coverage: `${covered}/${input.requirements.length}`,
            problems: [],
          };
          break;
        }
        feedback = problems;
        row.problems = problems;
      }
      rows.push(row);
    }

    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(REPORTS, { recursive: true });
    const file = `${REPORTS}${date}-prd-${llm.provider}.md`;
    writeFileSync(
      file,
      [
        `# PRD eval — ${date} (quick set)`,
        "",
        `Provider: **${llm.provider}** · model: \`${llm.model}\`. Input: deterministic demo discovery, all but one requirement approved.`,
        "",
        `**Schema-valid and fully traced: ${rows.filter((r) => r.valid).length}/${rows.length}** (PF-030 gate: all).`,
        "",
        "| Fixture | Valid | Attempts | Functional | Non-functional | Requirements covered | Problems |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...rows.map(
          (r) =>
            `| ${r.id} | ${r.valid ? "✓" : "✗"} | ${r.attempts} | ${r.functional} | ${r.nonFunctional} | ${r.coverage} | ${r.problems.slice(0, 2).join("; ") || "none"} |`,
        ),
        "",
      ].join("\n"),
    );
    console.log(`Eval report: ${file}`);
    expect(rows.every((r) => r.valid)).toBe(true);
  }, 600_000);
});
