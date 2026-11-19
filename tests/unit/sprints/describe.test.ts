import { describe, expect, it } from "vitest";

import { describeActivity } from "@/components/projects/activity-list";
import type { AuditLog } from "@/src/modules/audit/schema";

const entry = (action: string, diff: Record<string, { from: unknown; to: unknown }>): AuditLog => ({
  id: "00000000-0000-4000-8000-000000000009",
  workspaceId: "00000000-0000-4000-8000-000000000008",
  actorId: "user-1",
  actorName: "Demo PM",
  entityType: "project",
  entityId: "00000000-0000-4000-8000-000000000007",
  action,
  diff,
  createdAt: "2026-11-19T10:00:00.000Z",
});

describe("sprint activity wording", () => {
  it("describes plans, moves, settings and sprint edits", () => {
    expect(
      describeActivity(
        entry("sprints.planned", {
          sprints: { from: null, to: 3 },
          stories: { from: null, to: 9 },
          unplanned: { from: null, to: 0 },
          keptByHand: { from: null, to: 2 },
        }),
      ),
    ).toBe("planned 9 stories into 3 sprints (kept 2 placed by hand)");
    expect(
      describeActivity(
        entry("sprint.story_moved", {
          story: { from: null, to: "US-004" },
          sprint: { from: 1, to: 2 },
        }),
      ),
    ).toBe("moved US-004 to sprint 2");
    expect(
      describeActivity(
        entry("sprint.story_moved", {
          story: { from: null, to: "US-004" },
          sprint: { from: 2, to: null },
        }),
      ),
    ).toBe("took US-004 out of the sprint plan");
    expect(
      describeActivity(
        entry("sprints.settings_updated", {
          velocity: { from: 25, to: 20 },
          startDate: { from: null, to: "2027-01-04" },
        }),
      ),
    ).toBe("set velocity to 20 points, sprint 1 starting 2027-01-04");
    expect(
      describeActivity(
        entry("sprint.updated", {
          sprint: { from: null, to: 2 },
          goal: { from: "Deliver Reports", to: "" },
          capacity: { from: 25, to: 0 },
        }),
      ),
    ).toBe("updated sprint 2 (goal back to the suggested one, capacity 25 → 0 points)");
  });
});
