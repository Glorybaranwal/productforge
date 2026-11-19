import { z } from "zod";

const IsoDate = z.iso.date({ error: "Use a date like 2026-11-23" });

/** Planning settings per project (PF-051). One row per project. */
export const SprintSettings = z.object({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  /** Points the team plans per sprint (its velocity). */
  velocity: z.number().int().min(1).max(500),
  /** First day of sprint 1 (YYYY-MM-DD). */
  startDate: IsoDate,
  updatedAt: z.iso.datetime(),
});
export type SprintSettings = z.infer<typeof SprintSettings>;

export const SprintSettingsInput = z.object({
  velocity: z.coerce
    .number({ error: "Enter the points your team finishes per sprint" })
    .int("Use a whole number")
    .min(1, "At least 1 point")
    .max(500, "500 points at most"),
  startDate: IsoDate,
});

export const Sprint = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int().positive(),
  goal: z.string().max(300),
  /** The goal was written by the planner; re-planning may rewrite it. Editing it makes it the PM's. */
  autoGoal: z.boolean(),
  /** Capacity for this sprint; starts at the velocity, lower it for holidays. */
  capacityPoints: z.number().int().min(0).max(500),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Sprint = z.infer<typeof Sprint>;

export const SprintUpdate = z
  .object({
    goal: z.string().trim().max(300, "Keep the goal under 300 characters").optional(),
    capacityPoints: z.coerce.number().int("Use a whole number").min(0).max(500).optional(),
  })
  .refine((v) => v.goal !== undefined || v.capacityPoints !== undefined, "Nothing to update");

/**
 * A story's place in the plan, by story code so it survives new versions. Approved stories are
 * never changed to record this (ADR-006, ADR-017).
 */
export const SprintItem = z.object({
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  storyCode: z.string().regex(/^US-\d{3,}$/),
  sprintNumber: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  /** Placed by a person; re-planning keeps it where it is. */
  pinned: z.boolean(),
  /** Why the planner put it here ("Must; after US-001"). */
  reason: z.string().max(300),
  updatedAt: z.iso.datetime(),
});
export type SprintItem = z.infer<typeof SprintItem>;

export const SprintMove = z.object({
  storyCode: z.string().regex(/^US-\d{3,}$/, "Unknown story"),
  /** null = back to "not planned". */
  sprintNumber: z.number().int().positive().max(52).nullable(),
});

export const PlanRequest = z.object({
  /** Keep stories people placed by hand (default) or plan everything from scratch. */
  keepPinned: z.boolean().default(true),
});

// ---------- Dates ----------

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Sprint n runs from start + (n−1)·length; it ends the day before the next one, or on Friday if that's a weekend. */
export function sprintDates(
  startDate: string,
  lengthDays: number,
  number: number,
): { start: string; end: string } {
  const start = new Date(toDate(startDate).getTime() + (number - 1) * lengthDays * DAY);
  let end = new Date(start.getTime() + (lengthDays - 1) * DAY);
  while (end.getUTCDay() === 0 || end.getUTCDay() === 6) end = new Date(end.getTime() - DAY);
  return { start: toIso(start), end: toIso(end) };
}

/** The next Monday after `today` (YYYY-MM-DD): a sensible default for sprint 1. */
export function nextMonday(today: string): string {
  const d = toDate(today);
  const add = (8 - d.getUTCDay()) % 7 || 7;
  return toIso(new Date(d.getTime() + add * DAY));
}

/** "23 Nov" / "23 Nov 2026" for display; UTC so it never shifts a day. */
export function formatDay(iso: string, withYear = false): string {
  return toDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/**
 * Starting velocity before the team has history: 5 points per person per two-week sprint,
 * scaled to the sprint length. Replace it with the real number after a sprint or two.
 */
export function suggestedVelocity(teamSize: number, sprintLengthDays: number): number {
  return Math.max(1, Math.round(teamSize * 5 * (sprintLengthDays / 14)));
}
