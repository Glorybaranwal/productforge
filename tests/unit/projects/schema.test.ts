import { describe, expect, it } from "vitest";

import {
  formatSprintCadence,
  formatSprintLength,
  ProjectInput,
  ProjectUpdate,
} from "@/src/modules/projects/schema";
import { validProject } from "@/tests/helpers/context";

describe("ProjectInput", () => {
  it("accepts a valid project and trims text", () => {
    const parsed = ProjectInput.parse({ ...validProject, name: "  Payments  " });
    expect(parsed.name).toBe("Payments");
  });

  it("coerces numeric form values", () => {
    const parsed = ProjectInput.parse({ ...validProject, teamSize: "7", sprintLengthDays: "21" });
    expect(parsed.teamSize).toBe(7);
    expect(parsed.sprintLengthDays).toBe(21);
  });

  it("rejects a one-character name", () => {
    const result = ProjectInput.safeParse({ ...validProject, name: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects a sprint length that isn't 1-4 weeks", () => {
    const result = ProjectInput.safeParse({ ...validProject, sprintLengthDays: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects a team size of zero", () => {
    const result = ProjectInput.safeParse({ ...validProject, teamSize: 0 });
    expect(result.success).toBe(false);
  });
});

describe("ProjectUpdate", () => {
  it("accepts a single field", () => {
    expect(ProjectUpdate.parse({ teamSize: 8 })).toEqual({ teamSize: 8 });
  });

  it("rejects an empty patch", () => {
    expect(ProjectUpdate.safeParse({}).success).toBe(false);
  });
});

describe("formatSprintLength", () => {
  it("formats days as weeks", () => {
    expect(formatSprintLength(7)).toBe("1 week");
    expect(formatSprintLength(14)).toBe("2 weeks");
    expect(formatSprintCadence(14)).toBe("2-week sprints");
  });
});
