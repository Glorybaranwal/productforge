import { z } from "zod";

import { EVIDENCE, REQUIREMENT_TYPES } from "@/src/modules/requirements/schema";
import { RequirementCode, StoryCode } from "@/src/modules/stories/schema";

/** What a change request does to an approved requirement (PF-053, ADR-018). */
export const CHANGE_KINDS = ["modify", "add", "withdraw"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  modify: "Change wording",
  add: "Add requirement",
  withdraw: "Withdraw requirement",
};

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "Must change",
  medium: "Likely to change",
  low: "Check",
};

export const IMPACT_KINDS = ["prd", "story", "criterion", "task"] as const;
export type ImpactKind = (typeof IMPACT_KINDS)[number];

// ---------- AI stage output ----------

/** One affected item, explained. `ref` is one of the refs the rules listed: PRD, US-003, US-003/AC-2, TASK-007. */
export const ImpactItem = z.object({
  ref: z.string().trim().min(1).max(40),
  kind: z.enum(IMPACT_KINDS),
  severity: z.enum(SEVERITIES),
  explanation: z.string().trim().min(10, "Explain the impact").max(400),
});
export type ImpactItem = z.infer<typeof ImpactItem>;

export const ImpactOutput = z.object({
  summary: z.string().trim().min(10).max(800),
  items: z.array(ImpactItem),
});
export type ImpactOutput = z.infer<typeof ImpactOutput>;

// ---------- Stored entities ----------

export const RequirementSnapshot = z.object({
  text: z.string().min(1),
  type: z.enum(REQUIREMENT_TYPES),
  evidence: z.enum(EVIDENCE),
});
export type RequirementSnapshot = z.infer<typeof RequirementSnapshot>;

/** Items the rules found affected; "Needs review" is derived from this after approval. */
export const Affected = z.object({ prd: z.boolean(), stories: z.array(StoryCode) });
export type Affected = z.infer<typeof Affected>;

/**
 * A change request (CR-01…). Proposed as DRAFT with an impact analysis; approving it inserts the
 * requirement's next version (ADR-006) — nothing approved is edited in place.
 */
export const RequirementChange = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int().positive(),
  kind: z.enum(CHANGE_KINDS),
  /** Null for an addition until it's approved and gets its code. */
  requirementCode: RequirementCode.nullable(),
  fromVersion: z.number().int().positive().nullable(),
  toVersion: z.number().int().positive().nullable(),
  before: RequirementSnapshot.nullable(),
  /** Null for a withdrawal. */
  after: RequirementSnapshot.nullable(),
  reason: z.string().min(3).max(500),
  /** DRAFT = proposed, APPROVED = in force, REJECTED = discarded. */
  status: z.enum(["DRAFT", "APPROVED", "REJECTED"]),
  affected: Affected,
  impact: ImpactOutput.nullable(),
  agentRunId: z.uuid().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type RequirementChange = z.infer<typeof RequirementChange>;

/** "Reviewed — no change needed" for one flagged item of one change. */
export const ImpactReview = z.object({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  changeId: z.uuid(),
  ref: z.union([z.literal("PRD"), StoryCode]),
  note: z.string().max(300),
  reviewedBy: z.string(),
  reviewedAt: z.iso.datetime(),
});
export type ImpactReview = z.infer<typeof ImpactReview>;

// ---------- API inputs ----------

const reason = z
  .string({ error: "Say why the requirement changes" })
  .trim()
  .min(3, "Say why the requirement changes")
  .max(500);
const text = z
  .string({ error: "Write the requirement" })
  .trim()
  .min(5, "Requirement must be at least 5 characters")
  .max(400);

export const ChangeProposal = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("modify"),
      requirementCode: RequirementCode,
      text,
      evidence: z.enum(EVIDENCE).default("EXPLICIT"),
      reason,
    }),
    z.object({
      kind: z.literal("add"),
      text,
      type: z.enum(REQUIREMENT_TYPES).default("functional"),
      evidence: z.enum(EVIDENCE).default("EXPLICIT"),
      reason,
    }),
    z.object({ kind: z.literal("withdraw"), requirementCode: RequirementCode, reason }),
  ],
  { error: "Choose what to change" },
);
export type ChangeProposal = z.infer<typeof ChangeProposal>;

export const ReviewInput = z.object({
  ref: z.union([z.literal("PRD"), StoryCode], { error: "Unknown item" }),
  note: z.string().trim().max(300, "Keep the note under 300 characters").default(""),
});

export const changeCode = (n: number) => `CR-${String(n).padStart(2, "0")}`;
