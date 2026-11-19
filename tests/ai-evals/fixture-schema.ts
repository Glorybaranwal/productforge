import { z } from "zod";

/**
 * Format of an AI eval fixture (tests/ai-evals/fixtures/NNN-<slug>.json).
 * Documented in tests/ai-evals/fixtures/README.md; scored as described in ADR-010.
 */

export const FIXTURE_CATEGORIES = [
  "normal",
  "vague",
  "contradictory",
  "missing_info",
  "complex",
] as const;

export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

/** Required mix of the full eval set (PF-004). */
export const CATEGORY_TARGETS: Record<FixtureCategory, number> = {
  normal: 5,
  vague: 4,
  contradictory: 4,
  missing_info: 4,
  complex: 3,
};

/** `pnpm eval:quick` runs exactly one `quick: true` fixture per category. */
export const QUICK_SET_SIZE = FIXTURE_CATEGORIES.length;

/** `NNN-kebab-slug.json`; the NNN part must equal the fixture's `id`. */
export const FIXTURE_FILENAME = /^(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;

const phrase = z.string().trim().min(2).max(200);

function phraseList(min: number) {
  return z
    .array(phrase)
    .min(min)
    .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length, {
      message: "Duplicate entries",
    });
}

export const EvalFixture = z
  .strictObject({
    id: z.string().regex(/^\d{3}$/, "id must be three digits, e.g. 007"),
    category: z.enum(FIXTURE_CATEGORIES),
    /** Part of the 5-fixture CI subset (ADR-010). */
    quick: z.boolean().optional(),
    /** For humans and reports only. Never sent to the model. */
    notes: z.string().trim().min(1).optional(),
    project: z.strictObject({
      domain: z.string().trim().min(1),
      audience: z.string().trim().min(1),
      teamSize: z.number().int().positive(),
    }),
    /** Raw stakeholder text exactly as a user would paste it. */
    input: z.string().trim().min(10),
    expected: z.strictObject({
      requirements: phraseList(1),
      /** Every fixture must yield at least one clarifying question (PF-024). */
      questionsAbout: phraseList(1),
      conflicts: phraseList(0),
      ambiguousTerms: phraseList(0),
      /** Hallucination checks: failing if stated with evidence EXPLICIT (ADR-010). */
      mustNotInvent: phraseList(1),
    }),
  })
  .superRefine((fixture, ctx) => {
    const { category, expected } = fixture;

    if (category === "contradictory" && expected.conflicts.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "conflicts"],
        message: "Contradictory fixtures must list at least one conflict",
      });
    }
    if (category !== "contradictory" && category !== "complex" && expected.conflicts.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "conflicts"],
        message: `Only contradictory or complex fixtures may list conflicts (got ${category})`,
      });
    }
    if (category === "vague" && expected.ambiguousTerms.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "ambiguousTerms"],
        message: "Vague fixtures must list at least one ambiguous term",
      });
    }
    if (category === "missing_info" && expected.questionsAbout.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["expected", "questionsAbout"],
        message: "Missing-info fixtures must expect at least 3 clarifying questions",
      });
    }
  });

export type EvalFixture = z.infer<typeof EvalFixture>;
