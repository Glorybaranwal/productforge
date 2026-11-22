/** ADR-010 summary gates and the markdown report for a discovery eval run. */
import { supportsTemperature } from "@/src/ai/openai-client";

import { JUDGE_PROMPT_VERSION } from "./judge";
import type { FixtureScore, ItemKind } from "./score";

const ratio = (m: number, t: number) => (t === 0 ? 1 : m / t);

export type EvalSummary = {
  fixtures: number;
  schemaValidRate: number;
  allHaveQuestions: boolean;
  requirementRecall: number;
  questionTopicRecall: number;
  conflictRecall: number;
  ambiguityRecall: number;
  inventionFailures: number;
  /** ADR-010 blocking gates: schema-valid ≥ 95 % and ≥ 1 question per fixture. */
  gatesPass: boolean;
};

export function summarize(scores: FixtureScore[]): EvalSummary {
  const sum = (pick: (s: FixtureScore) => { matched: number; total: number }) => {
    const totals = scores.reduce(
      (acc, s) => ({ m: acc.m + pick(s).matched, t: acc.t + pick(s).total }),
      { m: 0, t: 0 },
    );
    return ratio(totals.m, totals.t);
  };
  const schemaValidRate = ratio(scores.filter((s) => s.valid).length, scores.length);
  const allHaveQuestions = scores.every((s) => s.questions > 0);
  return {
    fixtures: scores.length,
    schemaValidRate,
    allHaveQuestions,
    requirementRecall: sum((s) => s.requirements),
    questionTopicRecall: sum((s) => s.questionTopics),
    conflictRecall: sum((s) => s.conflicts),
    ambiguityRecall: sum((s) => s.ambiguities),
    inventionFailures: scores.filter((s) => s.inventions.length > 0).length,
    gatesPass: schemaValidRate >= 0.95 && allHaveQuestions,
  };
}

/** Whether the Tier 2 judge ran, and if not, why (ADR-010: never in quick runs; the demo engine has no judge). */
export type Tier2Status = "ran" | "quick" | "demo";

/** What temperature the judge actually ran at (gpt-5 and o-series models reject the setting). */
export function judgeTemperatureText(model: string): string {
  return supportsTemperature(model)
    ? "temperature 0"
    : "model default temperature — gpt-5 and o-series models don't accept a temperature";
}

const TIER2_TEXT = (status: Tier2Status, model: string): string =>
  ({
    ran: `Tier 2 judge (\`${JUDGE_PROMPT_VERSION}\`, ${judgeTemperatureText(model)}) ran on the phrases Tier 1 missed`,
    quick: "Tier 2 skipped (quick run)",
    demo: "Tier 2 skipped (demo engine)",
  })[status];

const KIND_LABEL: Record<ItemKind, string> = {
  requirement: "Requirement",
  question: "Question topic",
  conflict: "Conflict",
  ambiguity: "Vague term",
};

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");

function itemRows(s: FixtureScore): string[] {
  return s.items.map((i) => {
    const how =
      i.tier === 1
        ? "Tier 1"
        : i.tier === 2
          ? `Tier 2 → ${i.outputItemId}: ${cell(i.reason ?? "")}`
          : "missed";
    return `| ${KIND_LABEL[i.kind]} | ${cell(i.phrase)} | ${how} |`;
  });
}

const pct = (n: number) => `${Math.round(n * 100)} %`;

export function renderReport(
  summary: EvalSummary,
  scores: FixtureScore[],
  meta: { provider: string; model: string; date: string; quick: boolean; tier2: Tier2Status },
): string {
  const rows = scores.map(
    (s) =>
      `| ${s.id} | ${s.category} | ${s.valid ? "✓" : "✗"} | ${s.questions} | ${s.requirements.matched}/${s.requirements.total} | ` +
      `${s.questionTopics.matched}/${s.questionTopics.total} | ${s.conflicts.total ? `${s.conflicts.matched}/${s.conflicts.total}` : "–"} | ` +
      `${s.ambiguities.total ? `${s.ambiguities.matched}/${s.ambiguities.total}` : "–"} | ${s.inventions.length ? s.inventions.join("; ") : "none"} |`,
  );
  const missed = scores
    .filter((s) => s.requirements.missed.length)
    .map((s) => `- ${s.id}: ${s.requirements.missed.join("; ")}`);
  return [
    `# Discovery eval — ${meta.date}${meta.quick ? " (quick set)" : ""}`,
    "",
    `Provider: **${meta.provider}** · model: \`${meta.model}\` · scoring: ADR-010 Tier 1 (content-word match) + Tier 2 judge prompt \`${JUDGE_PROMPT_VERSION}\`. ${TIER2_TEXT(meta.tier2, meta.model)}.`,
    "",
    "## Summary",
    "",
    "| Metric | Result | Gate |",
    "| --- | --- | --- |",
    `| Schema-valid output | ${pct(summary.schemaValidRate)} | ≥ 95 % (blocking) |`,
    `| Every fixture asks ≥ 1 question | ${summary.allHaveQuestions ? "yes" : "no"} | required (blocking) |`,
    `| Expected requirements found | ${pct(summary.requirementRecall)} | reported |`,
    `| Expected question topics covered | ${pct(summary.questionTopicRecall)} | reported |`,
    `| Expected conflicts flagged | ${pct(summary.conflictRecall)} | reported |`,
    `| Expected vague terms flagged | ${pct(summary.ambiguityRecall)} | reported |`,
    `| Fixtures with a mustNotInvent stated as EXPLICIT | ${summary.inventionFailures} | 0 |`,
    "",
    `**Blocking gates: ${summary.gatesPass ? "PASS" : "FAIL"}.** Recall counts Tier 1 and Tier 2 matches. Tier 1 is strict (paraphrases miss); only a Tier 2 run can recover them.`,
    "",
    "## Per fixture",
    "",
    "| Fixture | Category | Valid | Questions | Requirements | Question topics | Conflicts | Vague terms | Inventions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Missed requirements",
    "",
    ...(missed.length ? missed : ["None."]),
    "",
    "## Expected items by tier",
    "",
    ...scores.flatMap((s) => [
      `### Fixture ${s.id}`,
      "",
      "| Kind | Expected | Matched by |",
      "| --- | --- | --- |",
      ...(s.items.length ? itemRows(s) : ["| – | – | – |"]),
      "",
    ]),
  ].join("\n");
}
