import { z } from "zod";

/** Evidence labels are mandatory on every generated item (CLAUDE.md §7.4). */
export const EVIDENCE = ["EXPLICIT", "INFERRED", "ASSUMPTION", "OPEN_QUESTION"] as const;
export type Evidence = (typeof EVIDENCE)[number];

export const REQUIREMENT_TYPES = ["functional", "non_functional"] as const;
export const ARTIFACT_STATUS = ["DRAFT", "REVIEW", "APPROVED", "REJECTED", "NEEDS_REVIEW"] as const;
export const ORIGINS = ["ai", "human", "ai_edited"] as const;
export const QUESTION_STATES = ["open", "answered", "skipped", "assumption"] as const;

// ---------- Stored entities ----------

export const Requirement = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  /** Display code: FR-01 for functional, NFR-01 for non-functional. */
  code: z.string().regex(/^N?FR-\d{2,}$/),
  version: z.number().int().positive(),
  text: z.string().min(1),
  type: z.enum(REQUIREMENT_TYPES),
  evidence: z.enum(EVIDENCE),
  /** Verbatim span of the source that supports the requirement (required for AI EXPLICIT items). */
  sourceQuote: z.string().nullable(),
  /** Why the item was inferred or assumed. */
  rationale: z.string().nullable(),
  sourceId: z.string().nullable(),
  status: z.enum(ARTIFACT_STATUS),
  origin: z.enum(ORIGINS),
  agentRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});
export type Requirement = z.infer<typeof Requirement>;

export const ClarifyingQuestion = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  question: z.string().min(1),
  reason: z.string(),
  state: z.enum(QUESTION_STATES),
  /** The answer, or the assumption text when state is "assumption". */
  answer: z.string().nullable(),
  agentRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestion>;

export const Conflict = z.object({
  description: z.string().min(1),
  quotes: z.array(z.string()).min(1),
  question: z.string().min(1),
});
export type Conflict = z.infer<typeof Conflict>;

export const Ambiguity = z.object({
  term: z.string().min(1),
  quote: z.string().min(1),
  suggestedQuestion: z.string().min(1),
});
export type Ambiguity = z.infer<typeof Ambiguity>;

/** Latest discovery result for a project, plus the Gate 1 state. */
export const Discovery = z.object({
  projectId: z.uuid(),
  workspaceId: z.uuid(),
  agentRunId: z.uuid(),
  runCount: z.number().int().positive(),
  summary: z.string(),
  actors: z.array(z.string()),
  goals: z.array(z.string()),
  constraints: z.array(z.string()),
  conflicts: z.array(Conflict),
  ambiguities: z.array(Ambiguity),
  status: z.enum(["draft", "confirmed"]),
  updatedAt: z.iso.datetime(),
  confirmedBy: z.string().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
});
export type Discovery = z.infer<typeof Discovery>;

// ---------- AI stage output (validated before anything is saved) ----------

export const DiscoveryRequirementOutput = z.object({
  text: z.string().trim().min(5).max(400),
  type: z.enum(REQUIREMENT_TYPES),
  evidence: z.enum(EVIDENCE),
  sourceQuote: z.string().nullable(),
  sourceId: z.string().nullable(),
  rationale: z.string().nullable(),
});

export const DiscoveryOutput = z.object({
  summary: z.string().trim().min(1),
  requirements: z.array(DiscoveryRequirementOutput).min(1),
  actors: z.array(z.string().trim().min(1)),
  goals: z.array(z.string().trim().min(1)),
  constraints: z.array(z.string().trim().min(1)),
  questions: z
    .array(z.object({ question: z.string().trim().min(5), reason: z.string() }))
    .min(1, "Ask at least one clarifying question"),
  conflicts: z.array(Conflict),
  ambiguities: z.array(Ambiguity),
});
export type DiscoveryOutput = z.infer<typeof DiscoveryOutput>;

// ---------- API inputs ----------

export const RequirementEdit = z
  .object({
    text: z.string().trim().min(5, "Requirement must be at least 5 characters").max(400),
    type: z.enum(REQUIREMENT_TYPES),
    evidence: z.enum(EVIDENCE),
    status: z.enum(["DRAFT", "REJECTED"]),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "Provide at least one field to update",
  });

export const RequirementCreate = z.object({
  text: z.string().trim().min(5, "Requirement must be at least 5 characters").max(400),
  type: z.enum(REQUIREMENT_TYPES).default("functional"),
});

export const QuestionResolution = z.discriminatedUnion("state", [
  z.object({ state: z.literal("answered"), answer: z.string().trim().min(1, "Write an answer") }),
  z.object({
    state: z.literal("assumption"),
    answer: z.string().trim().min(1, "Describe the assumption"),
  }),
  z.object({ state: z.literal("skipped") }),
  z.object({ state: z.literal("open") }),
]);
export type QuestionResolution = z.infer<typeof QuestionResolution>;

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  EXPLICIT: "Explicit",
  INFERRED: "Inferred",
  ASSUMPTION: "Assumption",
  OPEN_QUESTION: "Open question",
};
