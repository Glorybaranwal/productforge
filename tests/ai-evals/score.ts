/** ADR-010 Tier 1 scoring: deterministic content-word matching of stage output against fixtures. */
import { contentWords } from "@/src/lib/text";
import type { DiscoveryOutput } from "@/src/modules/requirements/schema";

import type { EvalFixture } from "./fixture-schema";

/** Removes wording that describes the check rather than the thing ("stated as explicit", "(e.g. …)"). */
export function stripMeta(phrase: string): string {
  return phrase
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bstated as explicit\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "a named delivery app", "specific prices": whether something is *named* or *specific* needs judgement,
 * so Tier 1 leaves these mustNotInvent items to the Tier 2 judge instead of guessing.
 */
export function needsJudge(phrase: string): boolean {
  return /^\s*(a named|a specific|named|specific)\b/i.test(phrase);
}

const NEGATION = /\b(no|not|without|never|non)\s+(\w+)/gi;

/**
 * Tier 1: every content word of `expected` appears in one candidate. With `respectNegation`, a word
 * negated in the candidate ("no injury") doesn't count — used for the mustNotInvent check, not for
 * recall (conflicts are often about "no cash" vs "cash").
 */
export function matchesAny(
  expected: string,
  candidates: string[],
  respectNegation = false,
): boolean {
  const need = contentWords(stripMeta(expected));
  if (need.length === 0) return true;
  return candidates.some((candidate) => {
    const have = new Set(contentWords(candidate));
    const negated = respectNegation
      ? new Set([...candidate.matchAll(NEGATION)].flatMap((m) => contentWords(m[2] ?? "")))
      : new Set<string>();
    return need.every((w) => have.has(w) && !negated.has(w));
  });
}

export type FixtureScore = {
  id: string;
  category: EvalFixture["category"];
  valid: boolean;
  attempts: number;
  problems: string[];
  questions: number;
  requirements: { matched: number; total: number; missed: string[] };
  questionTopics: { matched: number; total: number };
  conflicts: { matched: number; total: number };
  ambiguities: { matched: number; total: number };
  /** mustNotInvent items stated with evidence EXPLICIT — each one fails the fixture. */
  inventions: string[];
};

const ratio = (m: number, t: number) => (t === 0 ? 1 : m / t);

export function scoreDiscovery(
  fixture: EvalFixture,
  output: DiscoveryOutput | null,
  attempts: number,
  problems: string[],
): FixtureScore {
  const e = fixture.expected;
  const empty = (list: string[]) => ({ matched: 0, total: list.length });
  if (!output) {
    return {
      id: fixture.id,
      category: fixture.category,
      valid: false,
      attempts,
      problems,
      questions: 0,
      requirements: { ...empty(e.requirements), missed: e.requirements },
      questionTopics: empty(e.questionsAbout),
      conflicts: empty(e.conflicts),
      ambiguities: empty(e.ambiguousTerms),
      inventions: [],
    };
  }
  // Score the requirement statements only: a long evidence quote must not inflate recall.
  const reqTexts = output.requirements.map((r) => r.text);
  const count = (list: string[], candidates: string[]) =>
    list.filter((x) => matchesAny(x, candidates)).length;
  const explicit = output.requirements.filter((r) => r.evidence === "EXPLICIT").map((r) => r.text);

  return {
    id: fixture.id,
    category: fixture.category,
    valid: true,
    attempts,
    problems,
    questions: output.questions.length,
    requirements: {
      matched: count(e.requirements, reqTexts),
      total: e.requirements.length,
      missed: e.requirements.filter((x) => !matchesAny(x, reqTexts)),
    },
    questionTopics: {
      matched: count(
        e.questionsAbout,
        output.questions.map((q) => q.question),
      ),
      total: e.questionsAbout.length,
    },
    conflicts: {
      matched: count(
        e.conflicts,
        output.conflicts.map((c) => `${c.description} ${c.quotes.join(" ")}`),
      ),
      total: e.conflicts.length,
    },
    ambiguities: {
      matched: count(
        e.ambiguousTerms,
        output.ambiguities.map((a) => a.term),
      ),
      total: e.ambiguousTerms.length,
    },
    inventions: e.mustNotInvent.filter((x) => !needsJudge(x) && matchesAny(x, explicit, true)),
  };
}

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

const pct = (n: number) => `${Math.round(n * 100)} %`;

export function renderReport(
  summary: EvalSummary,
  scores: FixtureScore[],
  meta: { provider: string; model: string; date: string; quick: boolean },
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
    `Provider: **${meta.provider}** · model: \`${meta.model}\` · scoring: ADR-010 Tier 1 (content-word match; no LLM judge yet).`,
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
    `**Blocking gates: ${summary.gatesPass ? "PASS" : "FAIL"}.** Tier 1 is strict: paraphrases count as misses until the Tier 2 judge lands (PF-028 follow-up).`,
    "",
    "## Per fixture",
    "",
    "| Fixture | Category | Valid | Questions | Requirements | Question topics | Conflicts | Vague terms | Inventions |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Missed requirements (Tier 1)",
    "",
    ...(missed.length ? missed : ["None."]),
    "",
  ].join("\n");
}
