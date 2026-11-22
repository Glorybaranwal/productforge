/**
 * Impact eval (PF-053). For each quick fixture, three changes to a requirement the demo backlog
 * covers: a changed number (or an added qualifier), a withdrawal and an addition. Measures validity,
 * whether criteria that quote an old number are rated "must change", whether an added qualifier
 * raises false alarms, and whether stories that exist only for a withdrawn requirement are "must change".
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";

import { getLLMClient } from "@/src/ai/llm-client";
import { loadPrompt } from "@/src/ai/prompts/load";
import type { ImpactInput } from "@/src/ai/schemas/impact";
import { impactRules, impactStage } from "@/src/ai/stages/impact.stage";
import { zodFieldErrors } from "@/src/lib/errors";
import { ImpactOutput } from "@/src/modules/impact/schema";
import { buildFixtureBacklog } from "@/tests/helpers/impact-input";

import { EvalFixture } from "./fixture-schema";
import { cappedEvalClient } from "./token-cap";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));

type Row = {
  id: string;
  target: string;
  valid: number;
  /** Criteria quoting the old number rated high / all criteria quoting it. */
  recall: [number, number];
  /** High-rated criteria when only a qualifier was added. */
  falseAlarms: number;
  /** Stories that only covered the withdrawn requirement rated high / all of them. */
  withdraw: [number, number];
  problems: string[];
};

describe("Impact eval (quick set)", () => {
  it("explains changes against only the items the rules found, and rates them sensibly", async () => {
    const { llm } = cappedEvalClient(getLLMClient(), inject("evalUsageFile"));
    const system = await loadPrompt("impact.v1.md");
    const fixtures = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${FIXTURES}${f}`, "utf8"))))
      .filter((f) => f.quick);

    const run = async (
      input: ImpactInput,
    ): Promise<{ output: ImpactOutput | null; problems: string[] }> => {
      let feedback: string[] | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const stage = impactStage("eval", input);
        const result = await llm.generateStructured({
          name: "impact",
          system,
          prompt: stage.renderPrompt(input),
          data: input,
          schema: ImpactOutput,
          feedback,
        });
        const parsed = ImpactOutput.safeParse(result.data);
        const problems = parsed.success
          ? impactRules.flatMap((rule) => rule(parsed.data, input))
          : zodFieldErrors(parsed.error).map((e) => `${e.path}: ${e.message}`);
        if (parsed.success && !problems.length) return { output: parsed.data, problems: [] };
        feedback = problems;
      }
      return { output: null, problems: feedback ?? [] };
    };

    const rows: Row[] = [];
    for (const fixture of fixtures) {
      const built = buildFixtureBacklog(fixture);
      // Prefer a covered requirement with a number in it: the clearest test of "still quotes the old value".
      const covered = built.requirements.filter(
        (r) => r.evidence !== "OPEN_QUESTION" && built.candidatesFor(r.code).stories.length,
      );
      const target = covered.find((r) => /\d/.test(r.text)) ?? covered[0];
      const row: Row = {
        id: fixture.id,
        target: target?.code ?? "–",
        valid: 0,
        recall: [0, 0],
        falseAlarms: 0,
        withdraw: [0, 0],
        problems: [],
      };
      rows.push(row);
      if (!target) {
        row.problems.push("no covered requirement");
        continue;
      }
      const project = { name: `Fixture ${fixture.id}`, domain: fixture.project.domain };
      const before = { text: target.text, type: target.type, evidence: target.evidence };
      const candidates = built.candidatesFor(target.code);
      const number = /\b\d+\b/.exec(target.text)?.[0];
      const afterText = number
        ? target.text.replace(new RegExp(`\\b${number}\\b`), String(Number(number) * 2 + 1))
        : `${target.text} for at least 30 days`;
      const scenarios: [string, ImpactInput][] = [
        [
          "modify",
          {
            project,
            candidates,
            change: {
              kind: "modify",
              code: target.code,
              before,
              after: { ...before, text: afterText },
              reason: "Eval",
            },
          },
        ],
        [
          "withdraw",
          {
            project,
            candidates,
            change: { kind: "withdraw", code: target.code, before, after: null, reason: "Eval" },
          },
        ],
        [
          "add",
          {
            project,
            candidates: built.candidatesFor(null),
            change: {
              kind: "add",
              code: null,
              before: null,
              after: {
                text: "Customers can download a yearly statement",
                type: "functional",
                evidence: "EXPLICIT",
              },
              reason: "Eval",
            },
          },
        ],
      ];
      for (const [kind, input] of scenarios) {
        const { output, problems } = await run(input);
        if (!output) {
          row.problems.push(`${kind}: ${problems.slice(0, 2).join("; ")}`);
          continue;
        }
        row.valid += 1;
        const high = new Set(output.items.filter((i) => i.severity === "high").map((i) => i.ref));
        const criteria = candidates.stories.flatMap((s) => s.criteria);
        if (kind === "modify" && number) {
          const quoting = criteria.filter((c) =>
            new RegExp(`\\b${number}\\b`).test(`${c.given} ${c.when} ${c.then}`),
          );
          row.recall = [quoting.filter((c) => high.has(c.ref)).length, quoting.length];
        }
        if (kind === "modify" && !number)
          row.falseAlarms = criteria.filter((c) => high.has(c.ref)).length;
        if (kind === "withdraw") {
          const only = candidates.stories.filter((s) => s.otherRequirements.length === 0);
          row.withdraw = [only.filter((s) => high.has(s.code)).length, only.length];
        }
      }
    }

    const sum = (pick: (r: Row) => [number, number]) =>
      rows.reduce<[number, number]>((acc, r) => [acc[0] + pick(r)[0], acc[1] + pick(r)[1]], [0, 0]);
    const recall = sum((r) => r.recall);
    const withdraw = sum((r) => r.withdraw);
    const alarms = rows.reduce((n, r) => n + r.falseAlarms, 0);
    const pct = ([a, b]: [number, number]) => (b ? `${Math.round((a / b) * 100)} %` : "n/a");
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(REPORTS, { recursive: true });
    const file = `${REPORTS}${date}-impact-${llm.provider}.md`;
    writeFileSync(
      file,
      [
        `# Impact eval — ${date} (quick set)`,
        "",
        `Provider: **${llm.provider}** · model: \`${llm.model}\`. Input: each fixture's demo backlog; three changes to the first covered requirement.`,
        "",
        `- **Valid and passing the rules: ${rows.reduce((n, r) => n + r.valid, 0)}/${rows.filter((r) => r.target !== "–").length * 3}** (only listed items, every story and the PRD explained, no duplicates; fixtures with nothing covered are skipped).`,
        `- **Criteria quoting a changed number rated "must change": ${pct(recall)}** (${recall[0]}/${recall[1]}; gate ≥ 90 %).`,
        `- **Stories that exist only for a withdrawn requirement rated "must change": ${pct(withdraw)}** (${withdraw[0]}/${withdraw[1]}; gate 100 %).`,
        `- False alarms when a qualifier is only added: ${alarms} criteria rated "must change" (target 0).`,
        "",
        "| Fixture | Requirement | Valid | Number recall | Withdraw | False alarms | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...rows.map(
          (r) =>
            `| ${r.id} | ${r.target} | ${r.valid}/3 | ${r.recall[1] ? `${r.recall[0]}/${r.recall[1]}` : "–"} | ${r.withdraw[1] ? `${r.withdraw[0]}/${r.withdraw[1]}` : "–"} | ${r.falseAlarms} | ${r.problems.join("; ") || "–"} |`,
        ),
        "",
      ].join("\n"),
    );
    console.log(`Eval report: ${file}`);
    expect(rows.every((r) => r.valid === 3 || r.target === "–")).toBe(true);
    if (recall[1]) expect(recall[0] / recall[1]).toBeGreaterThanOrEqual(0.9);
    if (withdraw[1]) expect(withdraw[0]).toBe(withdraw[1]);
    expect(alarms).toBe(0);
  }, 900_000);
});
