import type { Evidence, Requirement } from "@/src/modules/requirements/schema";
import type { Story } from "@/src/modules/stories/schema";

/** The links a requirement needs before it is fully traced, in order. */
export const TRACE_STEPS = ["prd", "story", "criteria", "tasks", "approved"] as const;
export type TraceStep = (typeof TRACE_STEPS)[number];
export const TRACE_STEP_LABELS: Record<TraceStep, string> = {
  prd: "In the approved PRD",
  story: "Has a story",
  criteria: "Has testable criteria",
  tasks: "Has estimated tasks",
  approved: "Has an approved story",
};

export type TraceStatus =
  "traced" | "in_review" | "incomplete" | "rejected_only" | "gap" | "waiting";
export const TRACE_STATUS_LABELS: Record<TraceStatus, string> = {
  traced: "Traced",
  in_review: "In review",
  incomplete: "Incomplete",
  rejected_only: "Story rejected",
  gap: "No story",
  waiting: "Waiting on an answer",
};

export type StoryRef = {
  id: string;
  code: string;
  title: string;
  status: Story["status"];
  version: number;
  criteria: { positive: number; negative: number; edge: number };
  tasks: number;
  hours: number;
  points: number | null;
};

export type RequirementTrace = {
  code: string;
  text: string;
  type: Requirement["type"];
  evidence: Evidence;
  /** Titles of the approved PRD's sections that reference this code. */
  prdSections: string[];
  /** Draft and approved stories that link this requirement. */
  stories: StoryRef[];
  /** Rejected stories that linked it (they don't count as coverage). */
  rejected: StoryRef[];
  steps: Record<TraceStep, boolean>;
  /** Share of steps done, 0–1; null for open questions (they wait for an answer). */
  score: number | null;
  status: TraceStatus;
};

export type StoryTrace = StoryRef & {
  epicCode: string;
  epicTitle: string;
  requirementCodes: string[];
  /** Linked codes that aren't approved requirements (should never happen; checked anyway). */
  unknownCodes: string[];
  dependsOn: string[];
  prdVersion: number | null;
  /** Written from an older approved PRD version than the current one. */
  stale: boolean;
};

export type GapKind =
  | "needs_review"
  | "no_story"
  | "rejected_only"
  | "orphan_story"
  | "not_approved"
  | "no_criteria"
  | "no_tasks"
  | "stale_story"
  | "not_in_prd"
  | "waiting";

export type Gap = {
  kind: GapKind;
  severity: "blocker" | "warning" | "info";
  message: string;
  /** Requirement and story codes involved. */
  codes: string[];
  action: { label: string; href: string } | null;
};

export type Traceability = {
  gate1Passed: boolean;
  prdVersion: number | null;
  /** Mean share of trace steps done over requirements that need a story, 0–100; null before Gate 1. */
  score: number | null;
  coverage: {
    /** Requirements that need a story (approved, not open questions). */
    required: number;
    inPrd: number;
    withStory: number;
    testable: number;
    estimated: number;
    approved: number;
    waiting: number;
  };
  /** Approved stories linked only to approved requirements, 0–100 (PRD target: 100). */
  approvedStoriesTraced: number | null;
  requirements: RequirementTrace[];
  stories: StoryTrace[];
  gaps: Gap[];
  totals: {
    stories: number;
    approvedStories: number;
    criteria: number;
    tasks: number;
    hours: number;
    points: number;
  };
};
