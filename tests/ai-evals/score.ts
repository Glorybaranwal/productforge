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

export type ItemKind = "requirement" | "question" | "conflict" | "ambiguity";

/** How one expected phrase was matched: Tier 1 (content words), Tier 2 (judge) or not at all. */
export type ItemMatch = {
  kind: ItemKind;
  phrase: string;
  tier: 1 | 2 | null;
  /** Tier 2 only. */
  outputItemId?: string;
  reason?: string;
};

export type Candidate = { id: string; text: string };
export type Candidates = Record<ItemKind, Candidate[]>;

type Tally = { matched: number; total: number };

export type FixtureScore = {
  id: string;
  category: EvalFixture["category"];
  valid: boolean;
  attempts: number;
  problems: string[];
  questions: number;
  requirements: Tally & { missed: string[] };
  questionTopics: Tally;
  conflicts: Tally;
  ambiguities: Tally;
  /** mustNotInvent items stated with evidence EXPLICIT — each one fails the fixture. */
  inventions: string[];
  /** Per expected phrase: which tier matched it. Recall counts Tier 1 + Tier 2. */
  items: ItemMatch[];
};

/** What each list of the output offers to match against (requirement statements only: a long quote must not inflate recall). */
export function discoveryCandidates(output: DiscoveryOutput): Candidates {
  const list = (prefix: string, texts: string[]): Candidate[] =>
    texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text }));
  return {
    requirement: list(
      "R",
      output.requirements.map((r) => r.text),
    ),
    question: list(
      "Q",
      output.questions.map((q) => q.question),
    ),
    conflict: list(
      "C",
      output.conflicts.map((c) => `${c.description} ${c.quotes.join(" ")}`),
    ),
    ambiguity: list(
      "A",
      output.ambiguities.map((a) => a.term),
    ),
  };
}

const tally = (items: ItemMatch[], kind: ItemKind): Tally => {
  const of = items.filter((i) => i.kind === kind);
  return { matched: of.filter((i) => i.tier !== null).length, total: of.length };
};

/** Recomputes the recall counts from `items`; called after Tier 1 and again after Tier 2. */
export function withCounts(score: FixtureScore): FixtureScore {
  const missed = score.items.filter((i) => i.kind === "requirement" && i.tier === null);
  return {
    ...score,
    requirements: { ...tally(score.items, "requirement"), missed: missed.map((i) => i.phrase) },
    questionTopics: tally(score.items, "question"),
    conflicts: tally(score.items, "conflict"),
    ambiguities: tally(score.items, "ambiguity"),
  };
}

/** Records Tier 2 verdicts (one per previously missed phrase of `kind`) on a score. */
export function applyJudgeVerdicts(
  score: FixtureScore,
  kind: ItemKind,
  verdicts: { phrase: string; match: boolean; outputItemId: string | null; reason: string }[],
): FixtureScore {
  const items = score.items.map((item): ItemMatch => {
    if (item.kind !== kind || item.tier !== null) return item;
    const v = verdicts.find((x) => x.phrase === item.phrase);
    if (!v?.match || v.outputItemId === null) return item;
    return { ...item, tier: 2, outputItemId: v.outputItemId, reason: v.reason };
  });
  return withCounts({ ...score, items });
}

export function scoreDiscovery(
  fixture: EvalFixture,
  output: DiscoveryOutput | null,
  attempts: number,
  problems: string[],
): FixtureScore {
  const e = fixture.expected;
  const lists: [ItemKind, string[]][] = [
    ["requirement", e.requirements],
    ["question", e.questionsAbout],
    ["conflict", e.conflicts],
    ["ambiguity", e.ambiguousTerms],
  ];
  const candidates = output ? discoveryCandidates(output) : null;
  const items = lists.flatMap(([kind, phrases]) =>
    phrases.map((phrase): ItemMatch => ({
      kind,
      phrase,
      tier:
        candidates &&
        matchesAny(
          phrase,
          candidates[kind].map((c) => c.text),
        )
          ? 1
          : null,
    })),
  );
  const explicit = output
    ? output.requirements.filter((r) => r.evidence === "EXPLICIT").map((r) => r.text)
    : [];
  return withCounts({
    id: fixture.id,
    category: fixture.category,
    valid: output !== null,
    attempts,
    problems,
    questions: output?.questions.length ?? 0,
    requirements: { matched: 0, total: 0, missed: [] },
    questionTopics: { matched: 0, total: 0 },
    conflicts: { matched: 0, total: 0 },
    ambiguities: { matched: 0, total: 0 },
    inventions: output
      ? e.mustNotInvent.filter((x) => !needsJudge(x) && matchesAny(x, explicit, true))
      : [],
    items,
  });
}

export { renderReport, summarize } from "./report";
export type { EvalSummary } from "./report";
