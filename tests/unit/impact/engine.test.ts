import { describe, expect, it } from "vitest";

import { changedTerms, runDemoImpact } from "@/src/ai/demo/impact-engine";
import type { ImpactInput } from "@/src/ai/schemas/impact";
import { impactRules } from "@/src/ai/stages/impact.stage";
import type { Candidates } from "@/src/modules/impact/candidates";
import { ImpactOutput } from "@/src/modules/impact/schema";

const candidates: Candidates = {
  prd: { version: 1, lines: ["Customers see the last 90 days of transactions"] },
  stories: [
    {
      code: "US-004",
      title: "See 90 days of transactions",
      sentence:
        "As a customer, I want to see my last 90 days of transactions so that I can check payments.",
      status: "APPROVED",
      version: 1,
      otherRequirements: [],
      sprint: 2,
      criteria: [
        {
          ref: "US-004/AC-1",
          kind: "positive",
          given: "I have transactions",
          when: "I open the list",
          then: "I see the last 90 days",
        },
        {
          ref: "US-004/AC-2",
          kind: "negative",
          given: "a transaction is older",
          when: "I open the list",
          then: "it is hidden",
        },
      ],
      tasks: [
        { ref: "TASK-010", title: "Query 90 days of transactions" },
        { ref: "TASK-011", title: "Build the list screen" },
      ],
    },
    {
      code: "US-005",
      title: "Filter transactions",
      sentence: "As a customer, I want to filter transactions so that I find one quickly.",
      status: "DRAFT",
      version: 1,
      otherRequirements: ["FR-03"],
      sprint: null,
      criteria: [
        {
          ref: "US-005/AC-1",
          kind: "positive",
          given: "a list",
          when: "I filter by amount",
          then: "matching rows show",
        },
      ],
      tasks: [],
    },
  ],
};

const input = (over: Partial<ImpactInput["change"]>, c: Candidates = candidates): ImpactInput => ({
  project: { name: "Dashboard", domain: "Fintech" },
  change: {
    kind: "modify",
    code: "FR-02",
    before: {
      text: "Customers can see the last 90 days of transactions",
      type: "functional",
      evidence: "EXPLICIT",
    },
    after: {
      text: "Customers can see the last 30 days of transactions",
      type: "functional",
      evidence: "EXPLICIT",
    },
    reason: "Storage costs",
    ...over,
  },
  candidates: c,
});
const valid = (i: ImpactInput) => {
  const out = runDemoImpact(i);
  expect(ImpactOutput.safeParse(out).success).toBe(true);
  expect(impactRules.flatMap((rule) => rule(out, i))).toEqual([]);
  return out;
};
const item = (out: ImpactOutput, ref: string) => out.items.find((i) => i.ref === ref);

describe("demo impact analyst (PF-053)", () => {
  it("finds the words and numbers that change", () => {
    expect(
      changedTerms("Keep records for 7 years in CSV", "Keep records for 5 years in PDF"),
    ).toEqual({
      removed: ["7 years", "7", "csv"],
      added: ["5 years", "pdf"],
    });
  });

  it("rates items that still quote the old value as must-change", () => {
    const out = valid(input({}));
    expect(out.summary).toContain('FR-02 changes "90 days" to "30 days"');
    expect(item(out, "PRD")).toMatchObject({ severity: "high" });
    expect(item(out, "US-004/AC-1")).toMatchObject({
      severity: "high",
      explanation: 'Still checks "90 days"; the requirement now says "30 days".',
    });
    expect(item(out, "US-004/AC-2")).toBeUndefined();
    expect(item(out, "TASK-010")).toMatchObject({ kind: "task", severity: "medium" });
    expect(item(out, "US-004")!.explanation).toContain(
      "Version 1 is approved, so the fix is a new version. It's planned in sprint 2.",
    );
    expect(item(out, "US-005")).toMatchObject({ severity: "low" });
  });

  it("explains a withdrawal: reject what exists only for it, unlink the rest", () => {
    const out = valid(input({ kind: "withdraw", after: null }));
    expect(item(out, "US-004")!.severity).toBe("high");
    expect(item(out, "US-004")!.explanation).toContain("Exists only for FR-02");
    expect(item(out, "US-005")).toMatchObject({ severity: "medium" });
    expect(item(out, "US-005")!.explanation).toContain("Also covers FR-03: drop the link to FR-02");
    expect(out.summary).toMatch(/^Withdraws FR-02\./);
  });

  it("an addition only touches the PRD", () => {
    const out = valid(
      input(
        { kind: "add", code: null, before: null },
        { prd: { version: 2, lines: [] }, stories: [] },
      ),
    );
    expect(out.items.map((i) => [i.ref, i.severity])).toEqual([["PRD", "medium"]]);
    expect(out.summary).toContain("start a new PRD version, then generate its story");
  });

  it("an evidence-only change is a re-read", () => {
    const before = input({}).change.before!;
    const out = valid(
      input({
        after: { ...before, evidence: "EXPLICIT" },
        before: { ...before, evidence: "ASSUMPTION" },
      }),
    );
    expect(out.summary).toContain("keeps its wording; only its evidence changes");
    expect(out.items.filter((i) => i.kind === "story").map((i) => i.severity)).toEqual([
      "low",
      "low",
    ]);
  });

  it("says when nothing is built on the requirement yet", () => {
    const out = valid(input({}, { prd: null, stories: [] }));
    expect(out.items).toEqual([]);
    expect(out.summary).toContain("No story links it yet. Only the requirement changes.");
  });
});

describe("impact stage rules", () => {
  const base = input({});
  const out = runDemoImpact(base);
  it("refuses invented items, wrong kinds, missing stories and duplicates", () => {
    const bad: ImpactOutput = {
      summary: out.summary,
      items: [
        ...out.items.filter((i) => i.ref !== "US-005"),
        { ref: "US-099", kind: "story", severity: "low", explanation: "An invented story." },
        { ref: "TASK-011", kind: "criterion", severity: "low", explanation: "Wrong kind of item." },
        { ...out.items[0]! },
      ],
    };
    expect(impactRules.flatMap((rule) => rule(bad, base))).toEqual([
      'items: "US-099" isn\'t one of the listed items — use only the refs given',
      "items: TASK-011 is a task, not a criterion",
      "items: explain the impact on US-005",
      "items: PRD appears more than once",
    ]);
  });
});
