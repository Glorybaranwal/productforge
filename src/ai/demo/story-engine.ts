/**
 * Deterministic story writer for demo mode (ADR-011). One story per capability requirement;
 * rules and refinements that name no user (limits, assumptions, answers) are attached to the
 * closest story so they become acceptance criteria instead of awkward stories of their own.
 */
import type { RequirementRef, StoryInput, StoryOutput } from "@/src/ai/schemas/backlog";
import { formatCode, type Priority } from "@/src/modules/stories/schema";

import { leadVerb, singularRole, storyPhrase, storyTitle, type StoryPhrase } from "./story-text";
import {
  CORE_TOPIC,
  keywordStems,
  overlap,
  QUALITY_TOPIC,
  qualityBenefit,
  RULE,
  TOPICS,
  topicFor,
  type Topic,
} from "./story-topics";
import { applyNote } from "./story-notes";

type Story = StoryOutput["stories"][number];

type Draft = {
  req: RequirementRef;
  extra: RequirementRef[];
  phrase: StoryPhrase;
  topic: Topic;
  asA: string;
  note: string | null;
};

const CREATE_VERBS = new Set(
  "submit create add upload book register self-register request record enter place apply post raise file capture scan order sign earn".split(
    " ",
  ),
);
const SIGN_IN = /\b(sign\w*\s+(?:in|up|on)|log\w*\s+in|register\w*|self-register)\b/i;

/** Rules, assumptions, short refinements and answers ("Notification channel: email") attach to a story. */
function isDetail(r: RequirementRef): boolean {
  return (
    RULE.test(r.text) ||
    r.evidence === "ASSUMPTION" ||
    r.text.split(/\s+/).length <= 8 ||
    /^[^:]{3,40}:\s/.test(r.text)
  );
}

function priorityOf(r: RequirementRef): Priority {
  if (/\b(nice to have|later phase|phase 2|eventually|(?:is|are|it's) optional)\b/i.test(r.text))
    return "could";
  if (r.evidence === "EXPLICIT") return "must";
  return r.evidence === "INFERRED" ? "should" : "could";
}

function defaultPersona(input: StoryInput): string {
  const named = input.prd.personas[0]?.name;
  return singularRole(named ?? input.project.audience);
}

function topicOf(r: RequirementRef, phrase: StoryPhrase): Topic {
  const topic = topicFor(phrase.iWant, r.text);
  if (r.type !== "non_functional") return topic;
  return topic.title === "Accounts & access" ? topic : QUALITY_TOPIC;
}

function benefitOf(d: Draft): { soThat: string; stated: boolean } {
  if (d.phrase.purpose) return { soThat: d.phrase.purpose, stated: true };
  if (d.req.type === "non_functional") return { soThat: qualityBenefit(d.req.text), stated: false };
  return { soThat: d.topic.benefit, stated: false };
}

const EVIDENCE_WORD = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
  ASSUMPTION: "assumption",
  OPEN_QUESTION: "open question",
} as const;

function toStory(d: Draft, code: string, epicCode: string): Story {
  const { soThat, stated } = benefitOf(d);
  const links = [d.req, ...d.extra];
  const rationale = [
    `From ${d.req.code} (${EVIDENCE_WORD[d.req.evidence]}).`,
    d.extra.length
      ? `${d.extra.map((r) => r.code).join(", ")} ${d.extra.length === 1 ? "is a rule or detail" : "are rules or details"} of this story and became acceptance criteria.`
      : "",
    stated
      ? "The benefit is stated in the source."
      : "Benefit inferred — confirm it with stakeholders.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    code,
    epicCode,
    title: storyTitle(d.phrase.iWant),
    asA: d.asA,
    iWant: d.phrase.iWant,
    soThat,
    priority: priorityOf(d.req),
    requirementCodes: links.map((r) => r.code),
    dependsOn: [],
    evidence: d.req.evidence,
    rationale,
  };
}

/** Builds drafts: capabilities and quality items get their own story; the rest attach by topic words. */
function draftsFor(input: StoryInput, reqs: RequirementRef[]): Draft[] {
  const persona = defaultPersona(input);
  const drafts: Draft[] = [];
  const loose: { req: RequirementRef; phrase: StoryPhrase }[] = [];
  for (const req of reqs) {
    const phrase = storyPhrase(req.text);
    if (req.type === "functional" && !phrase.actorLed && isDetail(req)) {
      loose.push({ req, phrase });
      continue;
    }
    drafts.push({
      req,
      extra: [],
      phrase,
      topic: topicOf(req, phrase),
      asA: phrase.actor ?? persona,
      note: null,
    });
  }
  for (const { req, phrase } of loose) {
    const words = keywordStems(req.text);
    let best: Draft | null = null;
    let score = 0;
    for (const d of drafts) {
      if (d.req.type !== "functional") continue;
      const s = overlap(
        words,
        keywordStems(`${d.req.text} ${d.extra.map((e) => e.text).join(" ")}`),
      );
      if (s > score) [best, score] = [d, s];
    }
    if (best) best.extra.push(req);
    else {
      drafts.push({
        req,
        extra: [],
        phrase,
        topic: topicOf(req, phrase),
        asA: phrase.business ? "product owner" : persona,
        note: null,
      });
    }
  }
  return drafts;
}

/** Create-before-use and sign-in-first dependencies. Create stories never depend on use stories, so no cycles. */
function linkDependencies(stories: Story[], input: StoryInput): void {
  const signIn =
    stories.find((s) => SIGN_IN.test(s.iWant) && s.asA !== "product owner")?.code ??
    input.existingStories.find((s) => SIGN_IN.test(s.title))?.code;
  for (const story of stories) {
    const verb = leadVerb(story.iWant);
    const deps = new Set<string>();
    if (verb && !CREATE_VERBS.has(verb)) {
      const mine = keywordStems(story.iWant.replace(/^to\s+\S+/, ""));
      for (const other of stories) {
        const otherVerb = leadVerb(other.iWant);
        if (other === story || !otherVerb || !CREATE_VERBS.has(otherVerb)) continue;
        if (overlap(mine, keywordStems(other.iWant.replace(/^to\s+\S+/, ""))) > 0)
          deps.add(other.code);
        if (deps.size >= 2) break;
      }
    }
    const isSignIn = story.code === signIn || SIGN_IN.test(story.iWant);
    if (signIn && !isSignIn && verb && story.asA !== "product owner") deps.add(signIn);
    story.dependsOn = [...deps];
  }
}

export function runDemoStories(input: StoryInput): StoryOutput {
  if (input.target) return regenerateOne(input, input.target);

  const toCover = new Set(input.toCover);
  const drafts = draftsFor(
    input,
    input.requirements.filter((r) => toCover.has(r.code)),
  );
  // A requirement whose earlier story was rejected: take the reviewer's reason as a note.
  for (const d of drafts) {
    const rejected = input.rejected.find((r) => r.requirementCodes.includes(d.req.code));
    if (rejected) d.note = rejected.reason;
  }

  const order = [...TOPICS.map((t) => t.title), CORE_TOPIC.title, QUALITY_TOPIC.title];
  drafts.sort((a, b) => order.indexOf(a.topic.title) - order.indexOf(b.topic.title));

  const epics: StoryOutput["epics"] = [];
  const epicCode = new Map(input.existingEpics.map((e) => [e.title.toLowerCase(), e.code]));
  let nextEpic = input.nextEpicNumber;
  let nextStory = input.nextStoryNumber;
  const stories: Story[] = [];
  for (const d of drafts) {
    const key = d.topic.title.toLowerCase();
    if (!epicCode.has(key)) {
      const code = formatCode("EP", nextEpic++, 2);
      epicCode.set(key, code);
      const covered = drafts.filter((x) => x.topic === d.topic).flatMap((x) => [x.req, ...x.extra]);
      epics.push({
        code,
        title: d.topic.title,
        description: `${d.topic.title} for ${input.project.name}. Covers ${covered.map((r) => r.code).join(", ")}.`,
      });
    }
    let story = toStory(d, formatCode("US", nextStory++, 3), epicCode.get(key)!);
    if (d.note) {
      const rejectedCode = input.rejected.find((r) =>
        r.requirementCodes.includes(d.req.code),
      )?.code;
      story = applyNote(story, d.note, `Rewritten after ${rejectedCode} was rejected`);
    }
    stories.push(story);
  }
  linkDependencies(stories, input);
  return { epics, stories };
}

function regenerateOne(input: StoryInput, target: NonNullable<StoryInput["target"]>): StoryOutput {
  const known = new Map(input.requirements.map((r) => [r.code, r]));
  const reqs = target.requirementCodes
    .map((c) => known.get(c))
    .filter((r): r is RequirementRef => !!r);
  const [primary, ...extra] = reqs.length ? reqs : input.requirements.slice(0, 1);
  if (!primary) throw new Error("No approved requirement to regenerate from");
  const phrase = storyPhrase(primary.text);
  const draft: Draft = {
    req: primary,
    extra,
    phrase,
    topic: topicOf(primary, phrase),
    asA: phrase.actor ?? (phrase.business ? "product owner" : target.asA),
    note: null,
  };
  const fresh = { ...toStory(draft, target.code, target.epicCode), dependsOn: target.dependsOn };
  const story = target.note.trim()
    ? applyNote(fresh, target.note, "Regenerated with note")
    : { ...fresh, rationale: `Regenerated from ${primary.code}. ${fresh.rationale}` };
  return { epics: [], stories: [story] };
}

export { applyNote } from "./story-notes";
