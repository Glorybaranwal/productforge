import { describe, expect, it } from "vitest";

import { diffPrd } from "@/src/modules/prd/diff";
import { prdToMarkdown } from "@/src/modules/prd/markdown";
import {
  PrdSectionPatch,
  traceabilityProblems,
  type Prd,
  type PrdContent,
} from "@/src/modules/prd/schema";

const content: PrdContent = {
  summary: "A dashboard for customers.",
  problem: "Customers can't see failed transactions.",
  goals: [{ goal: "Find transactions fast", metric: "Under 30 seconds" }],
  personas: [{ name: "Customer", needs: "See transactions" }],
  inScope: ["View transactions"],
  outOfScope: [],
  functionalRequirements: [
    { text: "Customers can view transactions", requirementCodes: ["FR-01"] },
  ],
  nonFunctionalRequirements: [{ text: "Pages load in 2 s", requirementCodes: ["NFR-01"] }],
  dependencies: [],
  assumptions: [{ text: "Email notifications", requirementCodes: ["FR-02"] }],
  risks: [],
  openQuestions: [],
};

describe("traceabilityProblems", () => {
  it("passes when every approved code is linked and every link exists", () => {
    expect(traceabilityProblems(content, ["FR-01", "FR-02", "NFR-01"])).toEqual([]);
  });

  it("reports links to unknown codes and approved requirements that are missing", () => {
    expect(traceabilityProblems(content, ["FR-01", "NFR-01", "FR-03"])).toEqual([
      "Links to requirements that don't exist: FR-02",
      "Approved requirements not covered by the PRD: FR-03",
    ]);
  });
});

describe("PrdSectionPatch", () => {
  it("accepts a valid section value", () => {
    expect(PrdSectionPatch.safeParse({ section: "summary", value: "New summary" }).success).toBe(
      true,
    );
  });

  it("rejects a functional requirement with no linked requirement", () => {
    const result = PrdSectionPatch.safeParse({
      section: "functionalRequirements",
      value: [{ text: "Unlinked", requirementCodes: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown sections", () => {
    expect(PrdSectionPatch.safeParse({ section: "pricing", value: "x" }).success).toBe(false);
  });
});

describe("diffPrd", () => {
  it("marks changed sections with added and removed lines", () => {
    const next = {
      ...content,
      inScope: ["View transactions", "Download reports"],
      summary: "A dashboard for customers.",
    };
    const diff = diffPrd(content, next);
    const scope = diff.find((d) => d.key === "inScope")!;
    expect(scope.changed).toBe(true);
    expect(scope.added).toEqual(["Download reports"]);
    expect(diff.find((d) => d.key === "summary")!.changed).toBe(false);
  });
});

describe("prdToMarkdown", () => {
  it("renders every section with traceability codes", () => {
    const prd = {
      version: 2,
      status: "APPROVED",
      approvedAt: "2026-11-19T10:00:00.000Z",
      content,
    } as Prd;
    const md = prdToMarkdown("Payments", prd);
    expect(md).toContain("# PRD — Payments");
    expect(md).toContain("_Approved · version 2 · 2026-11-19_");
    expect(md).toContain("- Customers can view transactions [FR-01]");
    expect(md).toContain("## Out of scope\n\n_None._");
  });
});
