import { describe, expect, it } from "vitest";

import {
  criterionFlags,
  dependencyCycles,
  duplicateCodes,
  errorsOf,
  messages,
  missingCriteria,
  missingTasks,
  orphanStories,
  oversizedTasks,
  uncoveredRequirements,
  unknownDependencies,
  vagueCriteria,
} from "@/src/ai/orchestrator/rules";

const story = (code: string, requirementCodes: string[] = ["FR-01"], dependsOn: string[] = []) => ({
  code,
  requirementCodes,
  dependsOn,
});
const crit = (
  storyCode: string,
  kind: "positive" | "negative" | "edge",
  then = "I see the list of 3 items",
) => ({
  storyCode,
  kind,
  given: "I'm signed in",
  when: "I open the list",
  then,
});

describe("business-rule validator (PF-044)", () => {
  it("orphan stories: no links, or links to unapproved requirements", () => {
    expect(messages(orphanStories([story("US-001", [])], ["FR-01"]))).toEqual([
      "US-001 isn't linked to any requirement",
    ]);
    expect(messages(orphanStories([story("US-002", ["FR-01", "FR-09"])], ["FR-01"]))).toEqual([
      "US-002 links to requirements that aren't approved: FR-09",
    ]);
    expect(orphanStories([story("US-003")], ["FR-01"])).toEqual([]);
  });

  it("uncovered requirements", () => {
    expect(
      messages(uncoveredRequirements([story("US-001", ["FR-01"])], ["FR-01", "NFR-01"])),
    ).toEqual(["NFR-01 has no story"]);
  });

  it("duplicate codes", () => {
    const v = duplicateCodes(
      [{ code: "US-001" }, { code: "US-001" }, { code: "US-002" }],
      "Story code",
    );
    expect(messages(v)).toEqual(["Story code US-001 is used 2 times"]);
  });

  it("unknown and self dependencies", () => {
    const v = unknownDependencies([story("US-001", ["FR-01"], ["US-001", "US-009"])], ["US-001"]);
    expect(messages(v)).toEqual([
      "US-001 depends on itself",
      "US-001 depends on unknown story US-009",
    ]);
  });

  it("dependency cycles are reported once each", () => {
    const v = dependencyCycles([
      story("US-001", ["FR-01"], ["US-002"]),
      story("US-002", ["FR-01"], ["US-003"]),
      story("US-003", ["FR-01"], ["US-001"]),
      story("US-004", ["FR-01"], ["US-001"]),
    ]);
    expect(messages(v)).toEqual(["Dependency cycle: US-001 → US-002 → US-003 → US-001"]);
    expect(dependencyCycles([story("US-001", ["FR-01"], ["US-002"]), story("US-002")])).toEqual([]);
  });

  it("missing criteria: at least 2, including a negative or edge case", () => {
    expect(messages(missingCriteria([{ code: "US-001" }], [crit("US-001", "positive")]))).toEqual([
      "US-001 needs at least 2 acceptance criteria (has 1)",
    ]);
    expect(
      messages(
        missingCriteria(
          [{ code: "US-001" }],
          [crit("US-001", "positive"), crit("US-001", "positive")],
        ),
      ),
    ).toEqual(["US-001 needs a negative or edge-case criterion"]);
    expect(
      missingCriteria([{ code: "US-001" }], [crit("US-001", "positive"), crit("US-001", "edge")]),
    ).toEqual([]);
  });

  it("missing tasks and estimates", () => {
    expect(messages(missingTasks([{ code: "US-001" }], []))).toEqual(["US-001 has no tasks"]);
    expect(
      messages(
        missingTasks(
          [{ code: "US-001" }],
          [{ storyCode: "US-001", title: "API", estimateHours: 0 }],
        ),
      ),
    ).toEqual(["US-001: 1 task(s) without an estimate"]);
  });

  it("oversized tasks are warnings, not errors", () => {
    const v = oversizedTasks([{ storyCode: "US-001", title: "Build it all", estimateHours: 24 }]);
    expect(v[0]!.severity).toBe("warning");
    expect(errorsOf(v)).toEqual([]);
  });

  it("vague criteria are flagged unless a number pins them down", () => {
    expect(criterionFlags(crit("US-001", "positive", "the page loads quickly"))).toEqual([
      '"quickly" isn\'t testable — add a time limit',
    ]);
    expect(
      criterionFlags(crit("US-001", "positive", "the page loads quickly, in under 2 seconds")),
    ).toEqual([]);
    expect(criterionFlags(crit("US-001", "positive", "it works"))).toEqual([
      "The expected result is too short to test — describe what you'll see",
    ]);
    expect(
      criterionFlags(crit("US-001", "edge", "TODO: describe the expected result"))[0],
    ).toContain("placeholder");
    expect(
      vagueCriteria([crit("US-001", "positive", "it works as expected for the user")])[0]!.severity,
    ).toBe("warning");
  });
});
