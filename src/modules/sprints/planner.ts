/**
 * Deterministic sprint planner (PF-052, ADR-017). Fits approved stories into sprints so that:
 * - a story never lands in an earlier sprint than a story it depends on,
 * - a sprint never goes over its capacity (a story bigger than a whole sprint gets a sprint of its
 *   own and is flagged),
 * - Must comes before Should before Could; ties go to stories that unblock the most others.
 * Stories people placed by hand (pinned) stay where they are; the planner fills around them.
 */
import type { Priority } from "@/src/modules/stories/schema";

export type PlanStory = {
  code: string;
  points: number | null;
  priority: Priority;
  dependsOn: string[];
};

export type Placement = { code: string; sprint: number; reason: string };
export type Unplanned = { code: string; reason: string };
export type PlanResult = { placements: Placement[]; unplanned: Unplanned[] };

const RANK: Record<Priority, number> = { must: 0, should: 1, could: 2 };
const LABEL: Record<Priority, string> = { must: "Must", should: "Should", could: "Could" };

/** Why a story can't be planned at all (no estimate, or it depends on something that can't be), or null. */
export function blockingReason(
  s: PlanStory,
  byCode: Map<string, PlanStory>,
  unplannable: Set<string>,
  seen = new Set<string>(),
): string | null {
  if (s.points === null) return "No story points yet — estimate it first";
  if (seen.has(s.code)) return null;
  seen.add(s.code);
  for (const d of s.dependsOn) {
    if (unplannable.has(d)) return `Depends on ${d}, which isn't approved`;
    const dep = byCode.get(d);
    if (!dep) return `Depends on ${d}, which doesn't exist`;
    const inner = blockingReason(dep, byCode, unplannable, seen);
    if (inner) return `Depends on ${d}, which can't be planned yet`;
  }
  return null;
}

export function planSprints(
  stories: PlanStory[],
  options: {
    /** Capacity of sprint n (1-based). */
    capacity: (sprint: number) => number;
    /** Hand-placed stories: code → sprint. */
    pinned: Map<string, number>;
    /** Codes of stories that exist but can't be planned (drafts, rejected). */
    unplannable: Set<string>;
  },
): PlanResult {
  const byCode = new Map(stories.map((s) => [s.code, s]));
  const unplanned: Unplanned[] = [];
  const sprintOf = new Map<string, number>();
  const used = new Map<number, number>();
  const placements: Placement[] = [];
  const pts = (s: PlanStory) => s.points ?? 0;
  const add = (s: PlanStory, sprint: number, reason: string) => {
    sprintOf.set(s.code, sprint);
    used.set(sprint, (used.get(sprint) ?? 0) + pts(s));
    placements.push({ code: s.code, sprint, reason });
  };

  // 1. Stories that can't be planned at all.
  const blocked = new Set<string>();
  for (const s of stories) {
    const why = blockingReason(s, byCode, options.unplannable);
    if (why) {
      unplanned.push({ code: s.code, reason: why });
      blocked.add(s.code);
    }
  }

  // 2. Pinned stories stay put.
  for (const s of stories) {
    const sprint = options.pinned.get(s.code);
    if (sprint !== undefined && !blocked.has(s.code)) add(s, sprint, "Placed by hand");
  }

  // 3. Everything else, in dependency order, by priority, filling each sprint.
  const dependents = new Map<string, string[]>();
  for (const s of stories)
    for (const d of s.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), s.code]);
  // A story something more important needs is planned like that story (a Should a Must waits on).
  const inherited = new Map<string, number>();
  const effective = (code: string, seen = new Set<string>()): number => {
    const known = inherited.get(code);
    if (known !== undefined) return known;
    const own = byCode.get(code);
    if (!own || seen.has(code)) return 2;
    seen.add(code);
    const r = Math.min(
      RANK[own.priority],
      ...(dependents.get(code) ?? []).map((c) => effective(c, seen)),
    );
    seen.delete(code);
    inherited.set(code, r);
    return r;
  };
  // Prerequisites of hand-placed stories go first, so the pins don't end up before their dependencies.
  const pinDeps = new Set<string>();
  const collect = (code: string) => {
    for (const d of byCode.get(code)?.dependsOn ?? []) {
      if (!pinDeps.has(d) && !options.pinned.has(d)) {
        pinDeps.add(d);
        collect(d);
      }
    }
  };
  for (const code of options.pinned.keys()) collect(code);
  const rank = (s: PlanStory) => (pinDeps.has(s.code) ? -1 : effective(s.code));
  const unblocks = (s: PlanStory) => dependents.get(s.code)?.length ?? 0;
  const order = (a: PlanStory, b: PlanStory) =>
    rank(a) - rank(b) || unblocks(b) - unblocks(a) || a.code.localeCompare(b.code);
  const why = (s: PlanStory) => {
    if (pinDeps.has(s.code)) return "Needed by a story placed by hand";
    if (effective(s.code) < RANK[s.priority]) {
      const needs = (dependents.get(s.code) ?? []).filter((c) => effective(c) < RANK[s.priority]);
      const list =
        needs.length > 3
          ? `${needs.slice(0, 2).join(", ")} and ${needs.length - 2} more`
          : needs.join(", ");
      return `${LABEL[s.priority]}, but ${list} ${needs.length === 1 ? "needs" : "need"} it first`;
    }
    return `${LABEL[s.priority]}${s.dependsOn.length ? `; after ${s.dependsOn.join(", ")}` : ""}`;
  };
  let remaining = stories.filter((s) => !blocked.has(s.code) && !sprintOf.has(s.code));

  const lastPin = Math.max(0, ...options.pinned.values());
  for (let sprint = 1; remaining.length > 0 && sprint <= 200; sprint++) {
    // Ready: every dependency already placed in this sprint or earlier.
    const readyNow = () =>
      remaining
        .filter((s) => s.dependsOn.every((d) => (sprintOf.get(d) ?? Infinity) <= sprint))
        .sort(order);
    // Nothing ready and no pins still to come: the rest wait on each other (a dependency loop).
    if (sprint > lastPin && readyNow().length === 0) break;
    const cap = options.capacity(sprint);
    if (cap <= 0) continue; // a sprint set to 0 (holidays) gets nothing
    let progress = true;
    while (progress) {
      progress = false;
      const ready = readyNow();
      const free = cap - (used.get(sprint) ?? 0);
      const first = ready[0];
      if (!first) break;
      const fits = ready.find((s) => pts(s) <= free);
      if (fits) {
        const reason =
          fits === first
            ? why(fits)
            : `${LABEL[fits.priority]}; fills the space left in sprint ${sprint}`;
        add(fits, sprint, reason);
        remaining = remaining.filter((s) => s !== fits);
        progress = true;
      } else if ((used.get(sprint) ?? 0) === 0 && pts(first) > cap) {
        add(first, sprint, `${pts(first)} points is more than a whole sprint (${cap}) — split it`);
        remaining = remaining.filter((s) => s !== first);
      }
    }
  }
  for (const s of remaining)
    unplanned.push({
      code: s.code,
      reason: "Couldn't be placed — its dependencies wait on each other",
    });
  return { placements, unplanned };
}
