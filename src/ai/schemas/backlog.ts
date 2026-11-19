import { z } from "zod";

import { EVIDENCE } from "@/src/modules/requirements/schema";
import {
  CriterionFields,
  EpicCode,
  StoryCode,
  StoryFields,
  STORY_POINTS,
  TaskFields,
  type Priority,
} from "@/src/modules/stories/schema";

// ---------- Outputs (validated before anything is saved) ----------

export const StoryOutput = z.object({
  /** New epics only; stories may also use the codes of existing epics. */
  epics: z.array(
    z.object({
      code: EpicCode,
      title: z.string().trim().min(3).max(80),
      description: z.string().trim().max(400),
    }),
  ),
  stories: z
    .array(
      StoryFields.omit({ storyPoints: true }).extend({
        code: StoryCode,
        epicCode: EpicCode,
        evidence: z.enum(EVIDENCE),
        rationale: z.string().trim().max(500),
      }),
    )
    .min(1, "Write at least one story"),
});
export type StoryOutput = z.infer<typeof StoryOutput>;

export const QaOutput = z.object({
  criteria: z
    .array(CriterionFields.extend({ storyCode: StoryCode, evidence: z.enum(EVIDENCE) }))
    .min(2),
});
export type QaOutput = z.infer<typeof QaOutput>;

export const TaskOutput = z.object({
  tasks: z.array(TaskFields.extend({ storyCode: StoryCode })).min(1),
  estimates: z.array(z.object({ storyCode: StoryCode, storyPoints: z.literal(STORY_POINTS) })),
});
export type TaskOutput = z.infer<typeof TaskOutput>;

// ---------- Inputs (built by each stage's loadContext; also what the demo engine reads) ----------

export type RequirementRef = {
  code: string;
  text: string;
  type: "functional" | "non_functional";
  evidence: (typeof EVIDENCE)[number];
};

type ProjectRef = {
  name: string;
  domain: string;
  audience: string;
  teamSize: number;
  sprintLengthDays: number;
};

/** A story the PM asked to regenerate, with their note. */
export type StoryTarget = {
  code: string;
  epicCode: string;
  title: string;
  asA: string;
  iWant: string;
  soThat: string;
  priority: Priority;
  requirementCodes: string[];
  dependsOn: string[];
  note: string;
};

export type StoryInput = {
  project: ProjectRef;
  prd: {
    version: number;
    summary: string;
    personas: { name: string; needs: string }[];
    inScope: string[];
    outOfScope: string[];
  };
  /** Every approved requirement: the only codes a story may link. */
  requirements: RequirementRef[];
  /** Codes that still need a story (empty when regenerating one story). */
  toCover: string[];
  existingEpics: { code: string; title: string }[];
  /** Current stories that are kept (approved, edited or drafts), for dependencies and to avoid duplicates. */
  existingStories: {
    code: string;
    epicCode: string;
    title: string;
    requirementCodes: string[];
    dependsOn: string[];
  }[];
  /** Stories people rejected, with their reasons: don't repeat the same mistake. */
  rejected: { code: string; title: string; requirementCodes: string[]; reason: string }[];
  nextStoryNumber: number;
  nextEpicNumber: number;
  target: StoryTarget | null;
};

export type BacklogStoryRef = {
  code: string;
  title: string;
  asA: string;
  iWant: string;
  soThat: string;
  requirements: RequirementRef[];
};

export type QaInput = {
  project: ProjectRef;
  stories: BacklogStoryRef[];
  /** Reviewer note when one story is being regenerated. */
  note: string | null;
  /** Story code → row id, for saving. Not shown to the model. */
  storyIds: Record<string, string>;
};

export type TaskInput = {
  project: ProjectRef;
  stories: (BacklogStoryRef & { criteria: z.infer<typeof CriterionFields>[] })[];
  note: string | null;
  storyIds: Record<string, string>;
};
