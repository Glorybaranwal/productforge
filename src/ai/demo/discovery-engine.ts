/**
 * Deterministic discovery engine used in demo mode (ADR-011) and as the offline baseline in evals.
 * It only states EXPLICIT what it can quote verbatim; everything else is INFERRED, ASSUMPTION or
 * OPEN_QUESTION. Source text is treated as data: lines addressed to AI systems are flagged, not obeyed.
 */
import { ANSWERS_SOURCE_ID, type DiscoveryInput } from "@/src/ai/schemas/discovery";
import type { Ambiguity, DiscoveryOutput } from "@/src/modules/requirements/schema";

import { conflictTopic, detectConflicts } from "./conflicts";
import {
  ACTOR_PATTERNS,
  AMBIGUOUS_TERMS,
  BASELINE_QUESTIONS,
  CONSTRAINT_SIGNAL,
  GAP_RULES,
  GOAL_SIGNAL,
  INJECTION_PATTERN,
  LIST_VERBS,
  NFR_PATTERN,
  OPEN_SIGNAL,
  REQUIREMENT_SIGNAL,
} from "./lexicon";
import { capitalize, normalize, splitSegments, unique, wordCount, type Segment } from "./text";

type Req = DiscoveryOutput["requirements"][number];
type Located = Segment & { sourceId: string; sourceName: string; sourceText: string };

const SKIP =
  /^(hi|hello|hey|thanks|thank you|regards|cheers|best|re|fwd?|subject|from|to|notes from|context)\b/i;
const FILLER = /^(also|plus|and|so|then|ideally|basically|oh|ok|okay),?\s+/i;
const MODAL =
  /\b(can|should be able to|must be able to|should|must|need to|needs to|want to|wants to|will)\b/i;

const typeOf = (text: string, label: string | null): Req["type"] =>
  NFR_PATTERN.test(text) || /\bnfrs?\b|non-functional/i.test(label ?? "")
    ? "non_functional"
    : "functional";

function cleanText(text: string): string {
  return capitalize(text.replace(FILLER, "").replace(/\s+/g, " ").trim());
}

/** "customers can view transactions, filter them and download reports" → one requirement per verb. */
function expandList(seg: Located): { text: string; quote: string }[] | null {
  const modal = MODAL.exec(seg.text);
  if (!modal) return null;
  const head = seg.text.slice(0, modal.index).trim();
  const tail = seg.text.slice(modal.index + modal[0].length).trim();
  // Split on commas, and on "and"/"or" only when a list verb follows ("filter them and download reports").
  const items = tail
    .split(/,\s*/)
    .flatMap((piece) => piece.split(/\s+(?:and|or)\s+(?=(\w+))/i).filter((_, i) => i % 2 === 0))
    .map((s) => s.replace(/^(?:and|or)\s+/i, "").trim())
    .filter(Boolean);
  // Re-join pieces that don't start with a verb: "order number and email" stays one item.
  const merged: string[] = [];
  for (const item of items) {
    const verb = LIST_VERBS.has(item.split(" ")[0]!.toLowerCase());
    if (verb || merged.length === 0) merged.push(item);
    else merged[merged.length - 1] += ` and ${item}`;
  }
  items.length = 0;
  items.push(...merged);
  if (items.length < 2 || !items.every((i) => LIST_VERBS.has(i.split(" ")[0]!.toLowerCase())))
    return null;

  const subject = /([A-Za-z-]+(?:\s[A-Za-z-]+)?)$/.exec(
    head.replace(/\b(where|so|that|which|who)\s*$/i, "").trim(),
  );
  const who = subject
    ? capitalize(subject[1]!.replace(/^(where|that|which|who)\s+/i, ""))
    : "Users";
  const object = items[0]!.split(" ").slice(1).join(" ");
  // Quote the whole sentence: more context for the reviewer, and still verbatim.
  return items.map((item) => ({
    text: `${who} ${modal[0]} ${object ? item.replace(/\b(them|it)\b/i, object) : item}`,
    quote: seg.text,
  }));
}

function extractRequirements(segments: Located[]): Req[] {
  const reqs: Req[] = [];
  for (const seg of segments) {
    if (
      INJECTION_PATTERN.test(seg.text) ||
      SKIP.test(seg.text) ||
      /^(goal|context|actors?)$/i.test(seg.label ?? "")
    )
      continue;
    if (/^open$/i.test(seg.label ?? "") || OPEN_SIGNAL.test(seg.text)) {
      reqs.push({
        text: cleanText(seg.text.replace(/\?$/, "")),
        type: typeOf(seg.text, seg.label),
        evidence: "OPEN_QUESTION",
        sourceQuote: seg.text,
        sourceId: seg.sourceId,
        rationale: "Stated as unresolved in the source.",
      });
      continue;
    }
    const looksLikeReq =
      REQUIREMENT_SIGNAL.test(seg.text) ||
      seg.listItem ||
      (wordCount(seg.text) <= 8 &&
        CONSTRAINT_SIGNAL.test(seg.text) &&
        !/[—–]|\(v\d+\)/.test(seg.text));
    if (!looksLikeReq || wordCount(seg.text) < 3) continue;

    const parts = expandList(seg) ?? [{ text: seg.text, quote: seg.text }];
    for (const part of parts) {
      reqs.push({
        text: cleanText(part.text),
        type: typeOf(part.text, seg.label),
        evidence: "EXPLICIT",
        sourceQuote: part.quote,
        sourceId: seg.sourceId,
        rationale: null,
      });
    }
  }
  return unique(reqs, (r) => normalize(r.text));
}

function inferRequirements(all: string, explicit: Req[]): Req[] {
  const out: Req[] = [];
  const has = (re: RegExp) => re.test(all);
  if (
    has(
      /\b(customers?|patients?|users?|employees?|students?|policyholders?|suppliers?|residents?)\b/i,
    ) &&
    !has(/\b(log ?in|sign ?in|account|sso)\b/i)
  ) {
    out.push({
      text: "Users sign in, and each user sees only the data they are allowed to see",
      type: "non_functional",
      evidence: "INFERRED",
      sourceQuote: null,
      sourceId: null,
      rationale:
        "The brief describes individual users and their data, which implies authenticated, scoped access.",
    });
  }
  if (has(/\b(notif\w*|alerts?|remind\w*)\b/i) && !has(/\b(email|sms|push|whatsapp|in-app)\b/i)) {
    out.push({
      text: "Notifications are delivered by email and in-app until the channel is confirmed",
      type: "functional",
      evidence: "ASSUMPTION",
      sourceQuote: null,
      sourceId: null,
      rationale: "No channel is specified; email and in-app are the lowest-cost defaults.",
    });
  }
  if (has(/\b(reports?|download\w*|exports?)\b/i) && !has(/\b(pdf|csv|excel|xlsx)\b/i)) {
    out.push({
      text: "Reports can be downloaded as CSV until the required format is confirmed",
      type: "functional",
      evidence: "ASSUMPTION",
      sourceQuote: null,
      sourceId: null,
      rationale: "No format is specified; CSV opens in every spreadsheet tool.",
    });
  }
  if (explicit.length === 0) {
    out.push({
      text: "Scope of the first release to be defined with stakeholders",
      type: "functional",
      evidence: "OPEN_QUESTION",
      sourceQuote: null,
      sourceId: null,
      rationale: "The brief has no concrete requirements yet.",
    });
  }
  return out;
}

/** A short label for an answered question: "Notification channel", "Definition of “fast”", … */
function topicFor(question: string): string {
  const known =
    GAP_RULES.find((g) => g.question === question)?.topic ??
    BASELINE_QUESTIONS.find(([q]) => q === question)?.[2] ??
    conflictTopic(question);
  if (known) return known;
  const term = AMBIGUOUS_TERMS.find(([, q]) => q === question)?.[0];
  if (term) return `Definition of “${term}”`;
  const decision = /^Can we decide (whether .+)\?$/.exec(question)?.[1];
  if (decision) return `Decision ${decision}`;
  if (/addressed to AI systems/.test(question)) return "Source clean-up";
  return question
    .replace(/\?$/, "")
    .replace(/\s+[—–-]\s+.*$/, "")
    .slice(0, 80);
}

function fromAnswers(input: DiscoveryInput): Req[] {
  return input.answers.flatMap((a): Req[] => {
    if (!a.answer || a.state === "skipped") return [];
    return [
      {
        text: cleanText(`${topicFor(a.question)}: ${a.answer}`).slice(0, 400),
        type: typeOf(`${a.question} ${a.answer}`, null),
        evidence: a.state === "answered" ? "EXPLICIT" : "ASSUMPTION",
        sourceQuote: a.state === "answered" ? a.answer : null,
        sourceId: a.state === "answered" ? ANSWERS_SOURCE_ID : null,
        rationale:
          a.state === "answered"
            ? "Answered during clarification."
            : "Marked as an assumption during clarification.",
      },
    ];
  });
}

function findAmbiguities(segments: Located[]): Ambiguity[] {
  const found: Ambiguity[] = [];
  const claimed: string[] = [];
  for (const [term, question] of AMBIGUOUS_TERMS) {
    if (claimed.some((t) => t.toLowerCase().includes(term.toLowerCase()))) continue;
    const re = new RegExp(
      `(^|[^\\w-])${term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w-])`,
      "i",
    );
    const seg = segments.find((s) => re.test(s.text));
    if (!seg) continue;
    claimed.push(term);
    found.push({ term, quote: seg.text, suggestedQuestion: question });
  }
  return found;
}

function collect(segments: Located[], all: string) {
  const actors = unique(
    ACTOR_PATTERNS.flatMap((re) => [...all.matchAll(re)].map((m) => m[1]!.toLowerCase())),
    (a) => a.replace(/s$/, ""),
  ).map(capitalize);
  const labelled = segments
    .filter((s) => /^actors?$/i.test(s.label ?? ""))
    .flatMap((s) => s.text.split(/,\s*/));
  const goals = segments
    .filter((s) => /^goals?$/i.test(s.label ?? "") || GOAL_SIGNAL.test(s.text))
    .map((s) => cleanText(s.text));
  const constraints = segments
    .filter((s) => CONSTRAINT_SIGNAL.test(s.text) && !INJECTION_PATTERN.test(s.text))
    .map((s) => cleanText(s.text));
  return {
    actors: unique([...labelled.map(capitalize), ...actors], (a) =>
      a.toLowerCase().replace(/s$/, ""),
    ).slice(0, 10),
    goals: unique(goals, normalize).slice(0, 6),
    constraints: unique(constraints, normalize).slice(0, 10),
  };
}

/** "Not sure yet whether X" / "Legal hasn't confirmed whether X" → "Can we decide whether X?" */
function openDecisionQuestion(text: string): string {
  const clean = text.replace(/[.?]+$/, "");
  const rest = clean.replace(
    /^.*?\b(?:not sure(?: yet)?|unclear|tbd|undecided|hasn't confirmed|has not confirmed)\s+(?=whether|if)/i,
    "",
  );
  return rest !== clean ? `Can we decide ${rest}?` : `Can you confirm: ${clean}?`;
}

export function runDemoDiscovery(input: DiscoveryInput): DiscoveryOutput {
  const segments: Located[] = input.sources.flatMap((src) =>
    splitSegments(src.text).map((s) => ({
      ...s,
      sourceId: src.id,
      sourceName: src.name,
      sourceText: src.text,
    })),
  );
  const all = input.sources.map((s) => s.text).join("\n");
  const resolved = new Set(input.answers.map((a) => normalize(a.question)));
  const isOpen = (q: string) => !resolved.has(normalize(q));

  const explicit = extractRequirements(segments);
  const requirements = unique(
    [...explicit, ...inferRequirements(all, explicit), ...fromAnswers(input)],
    (r) => normalize(r.text),
  );
  const conflicts = detectConflicts(segments).filter((c) => isOpen(c.question));
  const ambiguities = findAmbiguities(segments).filter((a) => isOpen(a.suggestedQuestion));
  const injected = segments.filter((s) => INJECTION_PATTERN.test(s.text));

  const questions = unique(
    [
      ...injected.map((s) => ({
        question: `"${s.sourceName}" contains text addressed to AI systems. It was treated as data and ignored — should it be removed from the source?`,
        reason: `Possible prompt injection: "${s.text.slice(0, 80)}${s.text.length > 80 ? "…" : ""}"`,
      })),
      ...conflicts.map((c) => ({ question: c.question, reason: `Conflict: ${c.description}` })),
      ...ambiguities.map((a) => ({
        question: a.suggestedQuestion,
        reason: `"${a.term}" isn't measurable yet.`,
      })),
      ...requirements
        .filter((r) => r.evidence === "OPEN_QUESTION" && r.sourceQuote)
        .map((r) => ({
          question: openDecisionQuestion(r.text),
          reason: "Marked open in the source.",
        })),
      ...GAP_RULES.filter((g) => g.when.test(all) && !(g.unless?.test(all) ?? false)).map((g) => ({
        question: g.question,
        reason: g.reason,
      })),
      ...(wordCount(all) < 25 || explicit.length < 2
        ? BASELINE_QUESTIONS.map(([question, reason]) => ({ question, reason }))
        : []),
    ],
    (q) => normalize(q.question),
  )
    .filter((q) => isOpen(q.question))
    .slice(0, 12);

  if (questions.length === 0) {
    questions.push({
      question:
        "Is anything missing before we confirm these requirements — edge cases, roles or integrations?",
      reason: "Final check before Gate 1.",
    });
  }

  const facts = collect(segments, all);
  const summary =
    `${input.project.name} (${input.project.domain}, for ${input.project.audience}): ` +
    `${requirements.length} requirements from ${input.sources.length} source${input.sources.length === 1 ? "" : "s"}` +
    (facts.actors.length ? ` involving ${facts.actors.slice(0, 4).join(", ")}` : "") +
    `. ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} and ${ambiguities.length} vague term${ambiguities.length === 1 ? "" : "s"} need decisions` +
    (injected.length ? "; text addressed to AI systems was found and ignored." : ".");

  return { summary, requirements, ...facts, questions, conflicts, ambiguities };
}
