/**
 * The sprint board (PF-052): sprints with their stories, what isn't planned and why, and every
 * dependency or capacity problem — computed on each read, so hand moves are always checked.
 */
import { nowIso } from "@/src/lib/ids";
import { flagLabel } from "@/src/modules/impact/flags";
import type { Project } from "@/src/modules/projects/schema";
import type { Priority, Story } from "@/src/modules/stories/schema";
import type { BacklogContext } from "@/src/modules/stories/state";

import { blockingReason, type PlanStory } from "./planner";
import type { PlanRows } from "./repository";
import { nextMonday, sprintDates, suggestedVelocity } from "./schema";

export type BoardStory = {
  id: string;
  code: string;
  title: string;
  priority: Priority;
  points: number | null;
  epicCode: string;
  epicTitle: string;
  dependsOn: string[];
  status: Story["status"];
  version: number;
  pinned: boolean;
  /** Why it's here (planned) or why it isn't (unplanned). */
  reason: string;
  /** Problems with where it sits (dependency order, not approved any more). */
  problems: string[];
  /** Approved requirement changes it hasn't been reviewed against (PF-053). */
  review: string[];
};

export type BoardSprint = {
  id: string;
  number: number;
  start: string;
  end: string;
  goal: string;
  autoGoal: boolean;
  capacity: number;
  points: number;
  stories: BoardStory[];
};

export type SprintBoard = {
  /** At least one approved story: there's something to plan. */
  ready: boolean;
  /** Saved settings, or the defaults planning would use (saved: false). */
  settings: { velocity: number; startDate: string; saved: boolean };
  suggestedVelocity: number;
  teamSize: number;
  sprintLengthDays: number;
  sprints: BoardSprint[];
  unplanned: BoardStory[];
  /** Drafts can't be planned until they're approved. */
  drafts: string[];
  warnings: string[];
  /** Planned or plannable stories flagged by a requirement change (PF-053): the banner. */
  review: { stories: { code: string; sprint: number | null }[]; changes: string[] };
  /** Sprints until the last planned story is done (empty holiday sprints in between count). */
  forecast: { sprints: number; points: number; end: string | null };
};

export function planStories(b: BacklogContext): {
  plannable: PlanStory[];
  unplannable: Set<string>;
} {
  const approved = b.current.filter((s) => s.status === "APPROVED");
  return {
    plannable: approved.map((s) => ({
      code: s.code,
      points: s.storyPoints,
      priority: s.priority,
      dependsOn: s.dependsOn,
    })),
    unplannable: new Set(b.current.filter((s) => s.status !== "APPROVED").map((s) => s.code)),
  };
}

export function buildBoard(
  b: BacklogContext,
  rows: PlanRows,
  project: Project,
  today = nowIso().slice(0, 10),
): SprintBoard {
  const epics = new Map(b.rows.epics.map((e) => [e.id, e]));
  const current = new Map(b.current.map((s) => [s.code, s]));
  const { plannable, unplannable } = planStories(b);
  const planByCode = new Map(plannable.map((s) => [s.code, s]));
  const itemOf = new Map(rows.items.map((i) => [i.storyCode, i]));
  const sprintOf = (code: string) => itemOf.get(code)?.sprintNumber;

  const view = (s: Story, reason: string): BoardStory => {
    const epic = epics.get(s.epicId);
    const item = itemOf.get(s.code);
    const problems: string[] = [];
    if (item) {
      if (s.status !== "APPROVED") {
        problems.push(
          s.status === "REJECTED"
            ? "Rejected — take it out of the plan"
            : `Version ${s.version} is a draft — approve it again before the sprint`,
        );
      }
      for (const d of s.dependsOn) {
        const at = sprintOf(d);
        if (at === undefined) problems.push(`Depends on ${d}, which isn't planned`);
        else if (at > item.sprintNumber)
          problems.push(`Depends on ${d} in sprint ${at}, which comes later`);
      }
    }
    return {
      id: s.id,
      code: s.code,
      title: s.title,
      priority: s.priority,
      points: s.storyPoints,
      epicCode: epic?.code ?? "EP-??",
      epicTitle: epic?.title ?? "Unknown epic",
      dependsOn: s.dependsOn,
      status: s.status,
      version: s.version,
      pinned: item?.pinned ?? false,
      reason,
      problems,
      review: (b.reviews.stories.get(s.code) ?? []).map(flagLabel),
    };
  };

  const length = project.sprintLengthDays;
  const settings = rows.settings
    ? { velocity: rows.settings.velocity, startDate: rows.settings.startDate, saved: true }
    : {
        velocity: suggestedVelocity(project.teamSize, length),
        startDate: nextMonday(today),
        saved: false,
      };
  const sprints: BoardSprint[] = rows.sprints.map((sp) => {
    const stories = rows.items
      .filter((i) => i.sprintNumber === sp.number && current.has(i.storyCode))
      .map((i) => view(current.get(i.storyCode)!, i.reason));
    const dates = sprintDates(settings.startDate, length, sp.number);
    return {
      id: sp.id,
      number: sp.number,
      ...dates,
      goal: sp.goal,
      autoGoal: sp.autoGoal,
      capacity: sp.capacityPoints,
      points: stories.reduce((n, s) => n + (s.points ?? 0), 0),
      stories,
    };
  });

  const unplanned = b.current
    .filter((s) => s.status === "APPROVED" && !itemOf.has(s.code))
    .map((s) =>
      view(
        s,
        blockingReason(planByCode.get(s.code)!, planByCode, unplannable) ??
          (rows.items.length
            ? "Not planned — drag it into a sprint or re-plan"
            : "Not planned yet"),
      ),
    );

  const warnings: string[] = [];
  for (const sp of sprints) {
    if (sp.points > sp.capacity)
      warnings.push(`Sprint ${sp.number} is over capacity: ${sp.points} of ${sp.capacity} points`);
    for (const s of sp.stories)
      for (const p of s.problems) warnings.push(`${s.code} (sprint ${sp.number}): ${p}`);
  }
  const flagged = [...sprints.flatMap((sp) => sp.stories), ...unplanned].filter(
    (s) => s.review.length,
  );
  const used = sprints.filter((s) => s.stories.length);
  const last = used.at(-1);
  // The calendar span: a holiday sprint with nothing in it still takes two weeks.
  return {
    ready: plannable.length > 0,
    settings,
    suggestedVelocity: suggestedVelocity(project.teamSize, length),
    teamSize: project.teamSize,
    sprintLengthDays: length,
    sprints,
    unplanned,
    drafts: b.current.filter((s) => s.status === "DRAFT").map((s) => s.code),
    warnings,
    review: {
      stories: flagged.map((s) => ({
        code: s.code,
        sprint: itemOf.get(s.code)?.sprintNumber ?? null,
      })),
      changes: [...new Set(flagged.flatMap((s) => s.review))].sort(),
    },
    forecast: {
      sprints: last?.number ?? 0,
      points: used.reduce((n, s) => n + s.points, 0),
      end: last ? last.end : null,
    },
  };
}
