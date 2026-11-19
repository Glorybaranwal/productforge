import { z } from "zod";

/** Sprint lengths offered in the UI, in days. */
export const SPRINT_LENGTHS = [7, 14, 21, 28] as const;

/** Suggestions for the domain field; any text is accepted. */
export const DOMAIN_SUGGESTIONS = [
  "Fintech",
  "Healthcare",
  "E-commerce",
  "B2B SaaS",
  "Edtech",
  "Logistics",
  "HR",
  "Insurance",
  "Public sector",
  "Marketplace",
] as const;

/** Fields a user provides when creating a project (PRD FR-01). Also used for client-side validation. */
export const ProjectInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be 80 characters or fewer"),
  domain: z
    .string()
    .trim()
    .min(2, "Domain must be at least 2 characters")
    .max(60, "Domain must be 60 characters or fewer"),
  audience: z
    .string()
    .trim()
    .min(2, "Describe the audience in at least 2 characters")
    .max(120, "Audience must be 120 characters or fewer"),
  teamSize: z.coerce
    .number({ error: "Team size must be a number" })
    .int("Team size must be a whole number")
    .min(1, "Team size must be at least 1")
    .max(100, "Team size must be 100 or fewer"),
  sprintLengthDays: z.coerce
    .number({ error: "Choose a sprint length" })
    .int()
    .refine((days) => (SPRINT_LENGTHS as readonly number[]).includes(days), {
      message: "Sprint length must be 1, 2, 3 or 4 weeks",
    }),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

/** PATCH body: any subset of the input fields, at least one. */
export const ProjectUpdate = ProjectInput.partial().refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { message: "Provide at least one field to update" },
);
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

export const Project = ProjectInput.extend({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** Null once the creator’s account is deleted (the audit log keeps their name). */
  createdBy: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof Project>;

export function formatSprintLength(days: number): string {
  const weeks = days / 7;
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

/** "2-week sprints" */
export function formatSprintCadence(days: number): string {
  return `${days / 7}-week sprints`;
}
