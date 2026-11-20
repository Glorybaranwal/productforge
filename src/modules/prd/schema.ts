import { z } from "zod";

const text = (max: number) => z.string().trim().min(1, "Can't be empty").max(max);
const CODE = /^N?FR-\d{2,}$/;

/** A PRD line linked to the Gate 1 requirements it comes from (traceability by default). */
export const TracedItem = z.object({
  text: text(600),
  requirementCodes: z.array(z.string().regex(CODE, "Use requirement codes like FR-01")),
});
export type TracedItem = z.infer<typeof TracedItem>;

const LinkedItem = TracedItem.extend({
  requirementCodes: TracedItem.shape.requirementCodes.min(1, "Link at least one requirement"),
});

export const Goal = z.object({ goal: text(300), metric: text(300) });
export const Persona = z.object({ name: text(80), needs: text(400) });
export const Risk = z.object({ risk: text(300), mitigation: text(400) });

/** PRD content (PF-030). Every functional / non-functional item links to ≥ 1 requirement code. */
export const PrdContent = z.object({
  summary: text(2000),
  problem: text(2000),
  goals: z.array(Goal).min(1, "Add at least one goal"),
  personas: z.array(Persona).min(1, "Add at least one persona"),
  inScope: z.array(text(300)).min(1, "List what's in scope"),
  outOfScope: z.array(text(300)),
  functionalRequirements: z.array(LinkedItem).min(1, "Add at least one functional requirement"),
  nonFunctionalRequirements: z.array(LinkedItem),
  dependencies: z.array(text(300)),
  assumptions: z.array(TracedItem),
  risks: z.array(Risk),
  openQuestions: z.array(TracedItem),
});
export type PrdContent = z.infer<typeof PrdContent>;
export type PrdSectionKey = keyof PrdContent;

export type SectionKind = "text" | "list" | "goals" | "personas" | "risks" | "traced";

/** Order, titles and editor kind of each section. */
export const PRD_SECTIONS: {
  key: PrdSectionKey;
  title: string;
  kind: SectionKind;
  hint: string;
}[] = [
  {
    key: "summary",
    title: "Summary",
    kind: "text",
    hint: "What we're building and for whom, in a few sentences.",
  },
  {
    key: "problem",
    title: "Problem",
    kind: "text",
    hint: "The pain today, and why it matters now.",
  },
  {
    key: "goals",
    title: "Goals and success metrics",
    kind: "goals",
    hint: "Each goal needs a measurable metric.",
  },
  { key: "personas", title: "Personas", kind: "personas", hint: "Who uses it and what they need." },
  { key: "inScope", title: "In scope", kind: "list", hint: "One item per line." },
  {
    key: "outOfScope",
    title: "Out of scope",
    kind: "list",
    hint: "What this release will not do.",
  },
  {
    key: "functionalRequirements",
    title: "Functional requirements",
    kind: "traced",
    hint: "Each links to ≥ 1 requirement.",
  },
  {
    key: "nonFunctionalRequirements",
    title: "Non-functional requirements",
    kind: "traced",
    hint: "Performance, security, compliance…",
  },
  {
    key: "dependencies",
    title: "Dependencies",
    kind: "list",
    hint: "Systems, teams or vendors we rely on.",
  },
  { key: "assumptions", title: "Assumptions", kind: "traced", hint: "To confirm before build." },
  {
    key: "risks",
    title: "Risks and mitigations",
    kind: "risks",
    hint: "What could go wrong, and the plan.",
  },
  { key: "openQuestions", title: "Open questions", kind: "traced", hint: "Still undecided." },
];

/** PATCH body: replace one section of a draft. */
export const PrdSectionPatch = z
  .object({
    section: z.enum(PRD_SECTIONS.map((s) => s.key) as [PrdSectionKey, ...PrdSectionKey[]]),
    value: z.unknown(),
  })
  .transform((patch, ctx) => {
    const parsed = PrdContent.shape[patch.section].safeParse(patch.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: [patch.section, ...issue.path],
        });
      }
      return z.NEVER;
    }
    return { section: patch.section, value: parsed.data };
  });

export const Prd = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().positive(),
  content: PrdContent,
  status: z.enum(["DRAFT", "APPROVED"]),
  origin: z.enum(["ai", "human", "ai_edited"]),
  agentRunId: z.uuid().nullable(),
  /** The approved version this draft was started from, if any. */
  basedOnVersion: z.number().int().positive().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});
export type Prd = z.infer<typeof Prd>;

/** All requirement codes a PRD links to, in any section. */
export function linkedCodes(content: PrdContent): Set<string> {
  const items = [
    ...content.functionalRequirements,
    ...content.nonFunctionalRequirements,
    ...content.assumptions,
    ...content.openQuestions,
  ];
  return new Set(items.flatMap((i) => i.requirementCodes));
}

/**
 * Traceability problems against the approved requirement codes: links to unknown codes, and
 * approved requirements the PRD doesn't mention anywhere. Shared by the AI stage and Gate 2.
 */
export function traceabilityProblems(content: PrdContent, approvedCodes: string[]): string[] {
  const known = new Set(approvedCodes);
  const linked = linkedCodes(content);
  const unknown = [...linked].filter((c) => !known.has(c)).sort();
  const missing = approvedCodes.filter((c) => !linked.has(c));
  return [
    ...(unknown.length ? [`Links to requirements that don't exist: ${unknown.join(", ")}`] : []),
    ...(missing.length
      ? [`Approved requirements not covered by the PRD: ${missing.join(", ")}`]
      : []),
  ];
}

/** Refusal when a second draft would open (ADR-028): there is one open draft per project. */
export const DRAFT_OPEN = "A draft of this PRD is already open — keep editing that one";
