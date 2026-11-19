/**
 * What a requirement change touches (PF-053), found by rules — never by the model: the approved
 * PRD lines that cite the requirement, the live stories that link it, their criteria and tasks,
 * and where those stories sit in the sprint plan.
 */
import type { PrdContent, TracedItem } from "@/src/modules/prd/schema";
import type { SprintItem } from "@/src/modules/sprints/schema";
import { storySentence } from "@/src/modules/stories/schema";
import type { BacklogContext } from "@/src/modules/stories/state";

import type { Affected, ChangeKind } from "./schema";

export type CandidateStory = {
  code: string;
  title: string;
  sentence: string;
  status: "DRAFT" | "APPROVED";
  version: number;
  /** Other requirements the story links (a withdrawal leaves these). */
  otherRequirements: string[];
  sprint: number | null;
  criteria: { ref: string; kind: string; given: string; when: string; then: string }[];
  tasks: { ref: string; title: string }[];
};

export type Candidates = {
  prd: { version: number; lines: string[] } | null;
  stories: CandidateStory[];
};

const TRACED: (keyof PrdContent)[] = [
  "functionalRequirements",
  "nonFunctionalRequirements",
  "assumptions",
  "openQuestions",
];

export function findCandidates(
  change: { kind: ChangeKind; requirementCode: string | null },
  b: Pick<BacklogContext, "prd" | "current" | "rows">,
  sprintItems: Pick<SprintItem, "storyCode" | "sprintNumber">[],
): Candidates {
  const code = change.requirementCode;
  let prd: Candidates["prd"] = null;
  if (b.prd) {
    const lines = TRACED.flatMap((key) => b.prd!.content[key] as TracedItem[])
      .filter((item) => code !== null && item.requirementCodes.includes(code))
      .map((item) => item.text);
    // An addition affects the PRD as a whole: it can't cover a requirement it has never seen.
    if (change.kind === "add" || lines.length) prd = { version: b.prd.version, lines };
  }
  const sprintOf = new Map(sprintItems.map((i) => [i.storyCode, i.sprintNumber]));
  const stories: CandidateStory[] =
    code === null
      ? []
      : b.current
          .filter((s) => s.status !== "REJECTED" && s.requirementCodes.includes(code))
          .map((s) => ({
            code: s.code,
            title: s.title,
            sentence: storySentence(s),
            status: s.status === "APPROVED" ? "APPROVED" : "DRAFT",
            version: s.version,
            otherRequirements: s.requirementCodes.filter((c) => c !== code),
            sprint: sprintOf.get(s.code) ?? null,
            criteria: b.rows.criteria
              .filter((c) => c.storyId === s.id)
              .map((c) => ({
                ref: `${s.code}/AC-${c.position + 1}`,
                kind: c.kind,
                given: c.given,
                when: c.when,
                then: c.then,
              })),
            tasks: b.rows.tasks
              .filter((t) => t.storyId === s.id)
              .map((t) => ({ ref: t.code, title: t.title })),
          }));
  return { prd, stories };
}

export function affectedOf(c: Candidates): Affected {
  return { prd: c.prd !== null, stories: c.stories.map((s) => s.code) };
}

/** Every ref the impact stage may mention, with its kind. */
export function candidateRefs(c: Candidates): Map<string, "prd" | "story" | "criterion" | "task"> {
  const refs = new Map<string, "prd" | "story" | "criterion" | "task">();
  if (c.prd) refs.set("PRD", "prd");
  for (const s of c.stories) {
    refs.set(s.code, "story");
    for (const ac of s.criteria) refs.set(ac.ref, "criterion");
    for (const t of s.tasks) refs.set(t.ref, "task");
  }
  return refs;
}
