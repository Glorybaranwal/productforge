/**
 * Phrasing helpers for the demo QA engine (ADR-011): outcomes, triggers and the checks for
 * non-functional stories.
 */
import type { BacklogStoryRef, QaOutput, RequirementRef } from "@/src/ai/schemas/backlog";
import { withArticle } from "@/src/modules/stories/schema";

export type Criterion = QaOutput["criteria"][number];
export type Kind = Criterion["kind"];
export type Category =
  | "create"
  | "upload"
  | "book"
  | "find"
  | "track"
  | "export"
  | "notify"
  | "decide"
  | "pay"
  | "change"
  | "retention"
  | "default";

export const singular = (noun: string) =>
  noun.replace(/(\w+?)(ies)$/i, "$1y").replace(/(\w+?[^s])s$/i, "$1");

/** "to sign in…" → "I can sign in…"; "annual plans to get 20% off" → "annual plans get 20% off". */
export function outcome(iWant: string): string {
  const t = iWant.trim();
  if (/^to\s/i.test(t)) return `I can ${t.replace(/^to\s+/i, "")}`;
  const m = /^(.+?)\s+to\s+(\w+)(.*)$/i.exec(t);
  const nounPhrase =
    m?.[1] && (/\b(that|which|who)\b|'s\b|,/i.test(m[1]) || m[1].split(/\s+/).length > 6);
  if (m?.[1] && m[2] && !nounPhrase) {
    const subject = m[1] === "them" ? "they" : m[1];
    const plural = /^(they|we)$/i.test(subject) || (/s$/i.test(subject) && !/ss$/i.test(subject));
    const verb = m[2].toLowerCase();
    const conj =
      verb === "be"
        ? plural
          ? "are"
          : "is"
        : verb === "have"
          ? plural
            ? "have"
            : "has"
          : plural
            ? verb
            : thirdPerson(verb);
    return `${subject} ${conj}${m[3]}`;
  }
  return `I get ${t}`;
}

function thirdPerson(verb: string): string {
  if (/(s|sh|ch|x|z|o)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return verb.replace(/y$/, "ies");
  return `${verb}s`;
}

export function trigger(phrase: string): string {
  const when = /\b(?:when|if)\s+(.+)$/i.exec(phrase)?.[1];
  if (when) return when;
  const before = /(\d+\s+\w+\s+before\s+.+)$/i.exec(phrase)?.[1];
  if (before) return `it is ${before}`;
  const forWhat = /\bfor\s+(.+)$/i.exec(phrase)?.[1];
  if (forWhat) return `${withArticle(singular(forWhat))} occurs`;
  return "the event I subscribed to happens";
}

/** Non-functional stories: the requirement itself is the positive check. */
export function qualityCriteria(
  story: BacklogStoryRef,
  primary: RequirementRef,
): [Kind, string, string, string][] {
  const text = primary.text;
  const positive: [Kind, string, string, string] = [
    "positive",
    "a production-like test environment",
    `we check ${primary.code}`,
    outcome(story.iWant),
  ];
  const edge: [Kind, string, string, string] =
    /\b(fast|speed|load|latency|response|seconds?|performance)\b/i.test(text)
      ? [
          "edge",
          "twice the normal number of users at the same time",
          `we check ${primary.code} again`,
          "the same target still holds",
        ]
      : /\b(secur\w*|private|allowed to see|sign\w* in|access)\b/i.test(text)
        ? [
            "negative",
            "someone without access",
            "they request data that isn't theirs",
            "access is refused and the attempt is logged",
          ]
        : /\b(keep|retain|records?|store|delete)\b/i.test(text)
          ? [
              "negative",
              "a record inside the retention period",
              "someone tries to delete it",
              "deletion is refused and the attempt is logged",
            ]
          : /\b(offline|no signal|connection)\b/i.test(text)
            ? [
                "edge",
                "I lose my connection while working",
                "I keep working and then reconnect",
                "nothing I entered is lost and it syncs within 1 minute",
              ]
            : /\b(wcag|accessib\w*)\b/i.test(text)
              ? [
                  "edge",
                  "I use only a keyboard and a screen reader",
                  "I complete each main task",
                  "every step can be completed and is announced",
                ]
              : /\b(english|spanish|languages?)\b/i.test(text)
                ? [
                    "edge",
                    "I switch to another supported language",
                    "I open each screen",
                    "every label and message appears in that language",
                  ]
                : [
                    "edge",
                    "the most demanding realistic conditions",
                    `we check ${primary.code}`,
                    "it still holds",
                  ];
  return [positive, edge];
}
