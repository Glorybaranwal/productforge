import { describe, expect, it } from "vitest";

import { autoGoal } from "@/src/modules/sprints/goals";
import { planSprints, type PlanResult, type PlanStory } from "@/src/modules/sprints/planner";
import {
  formatDay,
  nextMonday,
  sprintDates,
  suggestedVelocity,
} from "@/src/modules/sprints/schema";

const s = (
  code: string,
  points: number | null,
  priority: PlanStory["priority"] = "must",
  dependsOn: string[] = [],
) => ({
  code,
  points,
  priority,
  dependsOn,
});
const plan = (
  stories: PlanStory[],
  capacity: number | ((n: number) => number) = 8,
  pinned: Record<string, number> = {},
  unplannable: string[] = [],
) =>
  planSprints(stories, {
    capacity: typeof capacity === "number" ? () => capacity : capacity,
    pinned: new Map(Object.entries(pinned)),
    unplannable: new Set(unplannable),
  });
const sprintOf = (r: PlanResult) => Object.fromEntries(r.placements.map((p) => [p.code, p.sprint]));
const load = (r: PlanResult, stories: PlanStory[]) => {
  const pts = new Map(stories.map((x) => [x.code, x.points ?? 0]));
  const used = new Map<number, number>();
  for (const p of r.placements) used.set(p.sprint, (used.get(p.sprint) ?? 0) + pts.get(p.code)!);
  return used;
};

describe("sprint planner (PF-052)", () => {
  it("never schedules a story before something it depends on", () => {
    const stories = [
      s("US-003", 3, "must", ["US-002"]),
      s("US-002", 5, "could", ["US-001"]),
      s("US-001", 5, "should"),
    ];
    const at = sprintOf(plan(stories, 5));
    // A Must that needs a Could still waits for it.
    expect(at).toEqual({ "US-001": 1, "US-002": 2, "US-003": 3 });
  });

  it("plans a story a Must depends on like a Must, and says why", () => {
    const stories = [
      s("US-001", 5, "should"),
      s("US-002", 5, "must", ["US-001"]),
      s("US-003", 5, "must"),
      s("US-004", 5, "should"),
    ];
    const r = plan(stories, 5);
    expect(sprintOf(r)).toEqual({ "US-001": 1, "US-002": 2, "US-003": 3, "US-004": 4 });
    expect(r.placements.find((p) => p.code === "US-001")!.reason).toBe(
      "Should, but US-002 needs it first",
    );
  });

  it("puts a story in the same sprint as its dependency when there's room", () => {
    const at = sprintOf(plan([s("US-001", 3), s("US-002", 3, "must", ["US-001"])], 8));
    expect(at).toEqual({ "US-001": 1, "US-002": 1 });
  });

  it("never goes over a sprint's capacity", () => {
    const stories = [5, 3, 8, 2, 5, 3, 1, 8, 2].map((p, i) =>
      s(`US-00${i + 1}`, p, (["must", "should", "could"] as const)[i % 3]),
    );
    const r = plan(stories, 10);
    expect(r.unplanned).toEqual([]);
    for (const used of load(r, stories).values()) expect(used).toBeLessThanOrEqual(10);
  });

  it("puts Must before Should before Could", () => {
    const at = sprintOf(
      plan([s("US-001", 5, "could"), s("US-002", 5, "should"), s("US-003", 5, "must")], 5),
    );
    expect(at).toEqual({ "US-003": 1, "US-002": 2, "US-001": 3 });
  });

  it("fills space a bigger story can't use with a smaller one, and says so", () => {
    const r = plan([s("US-001", 5), s("US-002", 5, "should"), s("US-003", 2, "could")], 7);
    expect(sprintOf(r)).toEqual({ "US-001": 1, "US-003": 1, "US-002": 2 });
    expect(r.placements.find((p) => p.code === "US-003")!.reason).toBe(
      "Could; fills the space left in sprint 1",
    );
  });

  it("breaks priority ties by how many stories each one unblocks", () => {
    const stories = [
      s("US-001", 5),
      s("US-002", 5),
      s("US-003", 1, "should", ["US-002"]),
      s("US-004", 1, "should", ["US-002"]),
    ];
    expect(sprintOf(plan(stories, 5))["US-002"]).toBe(1);
  });

  it("gives a story bigger than a sprint a sprint of its own and flags it", () => {
    const r = plan([s("US-001", 3), s("US-002", 13, "should"), s("US-003", 3, "could")], 8);
    expect(sprintOf(r)).toEqual({ "US-001": 1, "US-003": 1, "US-002": 2 });
    expect(r.placements.find((p) => p.code === "US-002")!.reason).toBe(
      "13 points is more than a whole sprint (8) — split it",
    );
  });

  it("leaves out stories without points or whose dependencies can't be planned", () => {
    const r = plan(
      [
        s("US-001", null),
        s("US-002", 3, "must", ["US-001"]),
        s("US-003", 3, "must", ["US-009"]),
        s("US-004", 3, "must", ["US-005"]),
        s("US-006", 2),
      ],
      8,
      {},
      ["US-005"],
    );
    expect(sprintOf(r)).toEqual({ "US-006": 1 });
    expect(Object.fromEntries(r.unplanned.map((u) => [u.code, u.reason]))).toEqual({
      "US-001": "No story points yet — estimate it first",
      "US-002": "Depends on US-001, which can't be planned yet",
      "US-003": "Depends on US-009, which doesn't exist",
      "US-004": "Depends on US-005, which isn't approved",
    });
  });

  it("keeps hand-placed stories where they are and plans their dependencies first", () => {
    const stories = [
      s("US-001", 3, "could"),
      s("US-002", 3, "must"),
      s("US-003", 3, "should", ["US-001"]),
    ];
    const r = plan(stories, 6, { "US-003": 1 });
    const at = sprintOf(r);
    expect(at["US-003"]).toBe(1);
    expect(at["US-001"]).toBe(1); // a Could, but US-003 (placed by hand) needs it
    expect(at["US-002"]).toBe(2);
    expect(r.placements.find((p) => p.code === "US-003")!.reason).toBe("Placed by hand");
    expect(r.placements.find((p) => p.code === "US-001")!.reason).toBe(
      "Needed by a story placed by hand",
    );
  });

  it("skips a sprint with no capacity (holidays)", () => {
    const at = sprintOf(
      plan([s("US-001", 5), s("US-002", 5), s("US-003", 5)], (n) => (n === 2 ? 0 : 5)),
    );
    expect(at).toEqual({ "US-001": 1, "US-002": 3, "US-003": 4 });
  });

  it("stops on a dependency loop instead of planning forever", () => {
    const r = plan(
      [s("US-001", 3, "must", ["US-002"]), s("US-002", 3, "must", ["US-001"]), s("US-003", 3)],
      8,
    );
    expect(sprintOf(r)).toEqual({ "US-003": 1 });
    expect(r.unplanned.map((u) => u.code).sort()).toEqual(["US-001", "US-002"]);
  });

  it("is deterministic", () => {
    const stories = [
      s("US-004", 2, "should"),
      s("US-001", 3),
      s("US-003", 3, "could", ["US-001"]),
      s("US-002", 5),
    ];
    expect(plan(stories, 6)).toEqual(plan([...stories].reverse(), 6));
  });
});

describe("sprint dates and velocity", () => {
  it("runs two-week sprints back to back and ends them on a Friday", () => {
    expect(sprintDates("2026-11-23", 14, 1)).toEqual({ start: "2026-11-23", end: "2026-12-04" });
    expect(sprintDates("2026-11-23", 14, 2)).toEqual({ start: "2026-12-07", end: "2026-12-18" });
    expect(sprintDates("2026-11-23", 7, 3)).toEqual({ start: "2026-12-07", end: "2026-12-11" });
  });

  it("starts sprint 1 on the next Monday", () => {
    expect(nextMonday("2026-11-19")).toBe("2026-11-23"); // Thursday
    expect(nextMonday("2026-11-23")).toBe("2026-11-30"); // a Monday → the one after
    expect(nextMonday("2026-11-22")).toBe("2026-11-23"); // Sunday
  });

  it("suggests 5 points per person per two weeks", () => {
    expect(suggestedVelocity(5, 14)).toBe(25);
    expect(suggestedVelocity(3, 7)).toBe(8);
    expect(suggestedVelocity(1, 7)).toBe(3);
  });

  it("formats days without shifting them", () => {
    expect(formatDay("2026-11-23")).toBe("23 Nov");
    expect(formatDay("2026-12-04", true)).toBe("4 Dec 2026");
  });
});

describe("sprint goals", () => {
  const st = (epicCode: string, epicTitle: string, points: number) => ({
    epicCode,
    epicTitle,
    points,
  });
  it("names the epics the sprint delivers, biggest first", () => {
    expect(autoGoal([])).toBe("");
    expect(autoGoal([st("EP-01", "Accounts & access", 5)])).toBe("Deliver Accounts & access");
    expect(
      autoGoal([st("EP-01", "Accounts & access", 3), st("EP-02", "Payments & billing", 5)]),
    ).toBe("Deliver Payments & billing and Accounts & access");
    expect(
      autoGoal([
        st("EP-01", "A", 1),
        st("EP-02", "B", 2),
        st("EP-03", "C", 3),
        st("EP-04", "D", 1),
      ]),
    ).toBe("Deliver C, B and 2 more epics");
  });
});
