import { z } from "zod";

import { ARTIFACT_STATUS, EVIDENCE, ORIGINS } from "@/src/modules/requirements/schema";

/** MoSCoW without "won't": a story we won't build is rejected instead. */
export const PRIORITIES = ["must", "should", "could"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  must: "Must",
  should: "Should",
  could: "Could",
};

export const CRITERION_KINDS = ["positive", "negative", "edge"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export const CRITERION_KIND_LABELS: Record<CriterionKind, string> = {
  positive: "Positive",
  negative: "Negative",
  edge: "Edge case",
};

/** Fibonacci story points; 13 means "split this story". */
export const STORY_POINTS = [1, 2, 3, 5, 8, 13] as const;

export const RequirementCode = z
  .string()
  .regex(/^N?FR-\d{2,}$/, "Use a requirement code such as FR-01");
export const StoryCode = z.string().regex(/^US-\d{3,}$/, "Use a story code such as US-001");
export const EpicCode = z.string().regex(/^EP-\d{2,}$/, "Use an epic code such as EP-01");

// ---------- Editable content (AI output and people's edits share these rules) ----------

export const StoryFields = z.object({
  title: z.string().trim().min(3, "Give the story a title").max(120),
  asA: z.string().trim().min(2, "Who is this for?").max(80),
  iWant: z.string().trim().min(3, "What do they want?").max(300),
  soThat: z.string().trim().min(3, "Why do they want it?").max(300),
  priority: z.enum(PRIORITIES),
  storyPoints: z.literal(STORY_POINTS).nullable(),
  requirementCodes: z.array(RequirementCode).min(1, "Link at least one requirement"),
  dependsOn: z.array(StoryCode),
});
export type StoryFields = z.infer<typeof StoryFields>;

export const CriterionFields = z.object({
  kind: z.enum(CRITERION_KINDS),
  given: z.string().trim().min(3, "Describe the starting situation").max(400),
  when: z.string().trim().min(3, "Describe the action").max(400),
  then: z.string().trim().min(3, "Describe the expected result").max(400),
});
export type CriterionFields = z.infer<typeof CriterionFields>;

export const TaskFields = z.object({
  title: z.string().trim().min(3, "Give the task a title").max(120),
  description: z.string().trim().max(500),
  estimateHours: z
    .number({ error: "Enter an estimate in hours" })
    .min(0.5, "At least 0.5 hours")
    .max(40, "Over 40 hours — split the task"),
});
export type TaskFields = z.infer<typeof TaskFields>;

// ---------- Stored entities (demo store collections; Drizzle tables in PF-011) ----------

const generated = {
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  status: z.enum(ARTIFACT_STATUS),
  evidence: z.enum(EVIDENCE),
  origin: z.enum(ORIGINS),
  agentRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const Epic = z.object({
  ...generated,
  code: EpicCode,
  title: z.string().min(1),
  description: z.string(),
});
export type Epic = z.infer<typeof Epic>;

/**
 * One version of a user story. Approved versions are never changed (ADR-006): editing one inserts
 * version n+1 with the same code. The current story is the highest version of each code.
 */
export const Story = StoryFields.extend({
  ...generated,
  epicId: z.uuid(),
  code: StoryCode,
  version: z.number().int().positive(),
  basedOnVersion: z.number().int().positive().nullable(),
  /** Why the AI wrote it this way, or the reviewer note it was regenerated with. */
  rationale: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  /** The approved PRD version the story was generated from. */
  prdVersion: z.number().int().positive().nullable(),
  createdBy: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});
export type Story = z.infer<typeof Story>;

export const AcceptanceCriterion = CriterionFields.extend({
  ...generated,
  storyId: z.uuid(),
  position: z.number().int().nonnegative(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const TechnicalTask = TaskFields.extend({
  ...generated,
  storyId: z.uuid(),
  code: z.string().regex(/^TASK-\d{3,}$/),
  position: z.number().int().nonnegative(),
  sprintId: z.uuid().nullable(),
});
export type TechnicalTask = z.infer<typeof TechnicalTask>;

// ---------- API inputs ----------

/** Rows sent by the editor keep their id; new rows get a client-made UUID. */
export const CriterionRow = CriterionFields.extend({ id: z.uuid() });
export const TaskRow = TaskFields.extend({ id: z.uuid() });

const StoryEdit = StoryFields.extend({ epicId: z.uuid() });

/** PATCH /api/stories/:id — autosave of one editor section (draft stories only). */
export const StorySectionPatch = z.discriminatedUnion("section", [
  z.object({ section: z.literal("story"), value: StoryEdit }),
  z.object({ section: z.literal("criteria"), value: z.array(CriterionRow).max(20) }),
  z.object({ section: z.literal("tasks"), value: z.array(TaskRow).max(30) }),
]);
export type StorySectionPatch = z.infer<typeof StorySectionPatch>;

export const StoryCreate = StoryFields.omit({ dependsOn: true, storyPoints: true }).extend({
  epicId: z.uuid({ error: "Choose an epic" }),
});

export const StoryRejection = z.object({
  reason: z.string().trim().min(3, "Say why, so the next draft can do better").max(500),
});

export const StoryRegeneration = z.object({
  note: z.string().trim().max(1000).default(""),
});

// ---------- Helpers ----------

export function storyPointsFromHours(hours: number): (typeof STORY_POINTS)[number] {
  if (hours <= 4) return 1;
  if (hours <= 8) return 2;
  if (hours <= 14) return 3;
  if (hours <= 24) return 5;
  if (hours <= 36) return 8;
  return 13;
}

/** "a customer" / "an employee". */
export function withArticle(noun: string): string {
  const an =
    /^(?:hr|fbi|mba|fr|nfr|sms)\b/i.test(noun) ||
    (/^[aeiou]/i.test(noun) && !/^(?:u(?:s|ni|ti|ri|re|ro|ra|bi)|eu|one)/i.test(noun));
  return `${an ? "an" : "a"} ${noun}`;
}

/** "As a customer, I want to filter transactions so that I find payments quickly." */
export function storySentence(s: Pick<StoryFields, "asA" | "iWant" | "soThat">): string {
  const soThat = s.soThat.replace(/[.]+$/, "");
  return `As ${withArticle(s.asA)}, I want ${s.iWant} so that ${soThat}.`;
}

/** Current version of each story code (highest version wins), in code order. */
export function currentStories(stories: Story[]): Story[] {
  const latest = new Map<string, Story>();
  for (const s of stories) {
    const seen = latest.get(s.code);
    if (!seen || s.version > seen.version) latest.set(s.code, s);
  }
  return [...latest.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function nextNumber(codes: string[], prefix: string): number {
  return (
    codes
      .map((c) => new RegExp(`^${prefix}-(\\d+)$`).exec(c))
      .reduce((n, m) => (m ? Math.max(n, Number(m[1])) : n), 0) + 1
  );
}

export const formatCode = (prefix: string, n: number, width: number) =>
  `${prefix}-${String(n).padStart(width, "0")}`;
