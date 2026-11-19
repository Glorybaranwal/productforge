/**
 * Deterministic Given/When/Then writer for demo mode (ADR-011). Every story gets a positive, a
 * negative and an edge case shaped by what the story does (create, find, notify, decide…), plus
 * one criterion per extra requirement linked to it — rules become negative criteria.
 */
import type { BacklogStoryRef, QaInput, QaOutput, RequirementRef } from "@/src/ai/schemas/backlog";
import { withArticle } from "@/src/modules/stories/schema";

import { qualityCriteria, type Category, type Criterion, type Kind } from "./qa-phrasing";
import { templates } from "./qa-templates";
import { RULE } from "./story-topics";
import { lowerFirst } from "./text";

export { outcome } from "./qa-phrasing";

const VERB_CATEGORY: [Category, string][] = [
  ["upload", "upload scan attach"],
  ["book", "book reschedule schedule"],
  [
    "create",
    "submit create add register self-register request record enter place apply post raise file capture order sign earn complete launch",
  ],
  ["find", "view see filter search find browse sort list check compare look"],
  ["track", "track monitor follow"],
  ["export", "export download print share generate"],
  ["notify", "receive notify alert remind send"],
  ["decide", "approve reject review assign escalate verify confirm flag block suspend"],
  ["pay", "pay refund checkout buy purchase subscribe"],
  ["change", "edit update change cancel delete remove manage rename set configure mark"],
];
const CATEGORY = new Map(
  VERB_CATEGORY.flatMap(([c, verbs]) => verbs.split(" ").map((v) => [v, c] as const)),
);
const STOP =
  /^(?:by|for|with|when|if|to|in|on|from|of|as|so|that|within|before|after|and|or|online|until|via|per|across)$/i;

/** Verb and object of "to filter transactions by date" → ["filter", "transactions"]. */
function verbAndObject(iWant: string): { verb: string | null; object: string; rest: string } {
  let phrase = iWant
    .replace(/^to\s+/i, "")
    .replace(/^(?:get|be)\s+notified\s+and\s+/i, "")
    .replace(/^\w+ly\s+/i, "");
  // "use an Android app to mark each stop…" → the real action is "mark"
  const use = /^use\s+.+?\s+to\s+(.+)$/i.exec(phrase);
  if (use?.[1]) phrase = use[1];
  if (!/^to\s/i.test(iWant)) return { verb: null, object: "", rest: phrase };
  const tokens = phrase
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const verb = tokens[0]?.toLowerCase().replace(/,$/, "") ?? null;
  let i = 1;
  // skip "book, reschedule and cancel" verb lists
  while (
    i < tokens.length &&
    (CATEGORY.has(tokens[i]!.toLowerCase().replace(/,$/, "")) || /^(and|or)$/i.test(tokens[i]!))
  )
    i++;
  while (i < tokens.length && /^(?:my|the|their|each|every|all|a|an|any|new)$/i.test(tokens[i]!))
    i++;
  const object: string[] = [];
  for (; i < tokens.length && object.length < 3; i++) {
    const t = tokens[i]!.replace(/[,;:]$/, "");
    if (STOP.test(t) || /^(?:it|them|this|that)$/i.test(t)) break;
    if (
      object.length &&
      (/ed$/i.test(t) || /^(?:live|now|today|instantly|automatically|anytime)$/i.test(t))
    )
      break;
    object.push(t);
    if (/[,;:]$/.test(tokens[i]!)) break;
  }
  // Long wishes: act on the first clause ("track my delivery live on a map, see an ETA…")
  const clauses = phrase.split(/,\s+/);
  const first = clauses[0] && clauses[0].split(/\s+/).length >= 3 ? clauses[0] : phrase;
  return { verb, object: object.join(" "), rest: first };
}

function categoryOf(
  story: BacklogStoryRef,
  verb: string | null,
  primary: RequirementRef,
): Category {
  const text = `${story.iWant} ${primary.text}`;
  if (/\b(keep|retain|store|delete)\b.*\b(years?|days?|months?)\b/i.test(text)) return "retention";
  const fromVerb = verb ? CATEGORY.get(verb) : undefined;
  if (fromVerb && !(verb === "get" || verb === "receive")) return fromVerb;
  if (/\b(notif\w*|alerts?|remind\w*|sms|push|emails?)\b/i.test(story.iWant)) return "notify";
  if (/\b(refund\w*|pay\w*|checkout)\b/i.test(story.iWant)) return "pay";
  return fromVerb ?? "default";
}

const evidenceOf = (r: RequirementRef): Criterion["evidence"] =>
  r.evidence === "EXPLICIT"
    ? "EXPLICIT"
    : r.evidence === "OPEN_QUESTION"
      ? "ASSUMPTION"
      : r.evidence;

/** A reviewer note "add an edge case: …" adds a case with a placeholder result the PM fills in. */
function noteCase(story: BacklogStoryRef, note: string | null): Criterion[] {
  const m = note && /\b(edge|negative)\s+case\b[^:–-]*[:–-]\s*([^.;]+)/i.exec(note);
  if (!m?.[1] || !m[2]) return [];
  return [
    {
      storyCode: story.code,
      kind: m[1].toLowerCase() as Kind,
      given: m[2].trim(),
      when: `I ${story.iWant.replace(/^to\s+/i, "")}`.slice(0, 400),
      then: "TODO: describe the expected result",
      evidence: "EXPLICIT",
    },
  ];
}

export function runDemoQa(input: QaInput): QaOutput {
  const criteria: Criterion[] = [];
  for (const story of input.stories) {
    const [primary, ...extra] = story.requirements;
    if (!primary) continue;
    const { verb, object, rest } = verbAndObject(story.iWant);
    const rows =
      primary.type === "non_functional"
        ? qualityCriteria(story, primary)
        : templates(story, categoryOf(story, verb, primary), verb ?? "use", object, rest);
    for (const [kind, given, when, then] of rows) {
      const own = kind === "positive" && primary.type === "non_functional";
      criteria.push({
        storyCode: story.code,
        kind,
        given: given.slice(0, 400),
        when: when.slice(0, 400),
        then: then.slice(0, 400),
        evidence: own ? evidenceOf(primary) : "INFERRED",
      });
    }
    const signedIn =
      story.asA === "product owner"
        ? "the feature is live"
        : `I'm signed in as ${withArticle(story.asA)}`;
    for (const r of extra) {
      const rule = RULE.test(r.text);
      const statement = lowerFirst(r.text.replace(/[.!]+$/, ""));
      criteria.push({
        storyCode: story.code,
        kind: rule ? "negative" : "positive",
        given: rule ? `the rule "${statement}" (${r.code})` : signedIn,
        when: rule ? "I try to do something the rule doesn't allow" : `I ${rest}`.slice(0, 400),
        then: rule
          ? "the action is refused and the message explains the rule"
          : `${statement} (${r.code})`.slice(0, 400),
        evidence: evidenceOf(r),
      });
    }
    criteria.push(...noteCase(story, input.note));
  }
  return { criteria };
}
