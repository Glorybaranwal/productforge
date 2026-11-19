import { describe, expect, it } from "vitest";

import {
  matchesAny,
  needsJudge,
  scoreDiscovery,
  stripMeta,
  summarize,
} from "@/tests/ai-evals/score";
import type { EvalFixture } from "@/tests/ai-evals/fixture-schema";
import type { DiscoveryOutput } from "@/src/modules/requirements/schema";

const fixture: EvalFixture = {
  id: "900",
  category: "contradictory",
  project: { domain: "fintech", audience: "customers", teamSize: 3 },
  input: "Customers can filter transactions. Free plan unlimited. Free plan capped at 3 projects.",
  expected: {
    requirements: ["filter transactions", "download reports"],
    questionsAbout: ["notification channel"],
    conflicts: ["unlimited vs capped at 3 projects"],
    ambiguousTerms: [],
    mustNotInvent: ["SMS notifications stated as explicit"],
  },
};

const output: DiscoveryOutput = {
  summary: "s",
  requirements: [
    {
      text: "Customers can filter transactions",
      type: "functional",
      evidence: "EXPLICIT",
      sourceQuote: "filter transactions",
      sourceId: "s1",
      rationale: null,
    },
    {
      text: "Send SMS notifications",
      type: "functional",
      evidence: "ASSUMPTION",
      sourceQuote: null,
      sourceId: null,
      rationale: "x",
    },
  ],
  actors: [],
  goals: [],
  constraints: [],
  questions: [{ question: "Which channel should notifications use?", reason: "r" }],
  conflicts: [
    {
      description: '"Free plan unlimited" vs "Free plan capped at 3 projects"',
      quotes: ["a", "b"],
      question: "q",
    },
  ],
  ambiguities: [],
};

describe("Tier 1 scoring", () => {
  it("matches when every content word appears, with plural folding", () => {
    expect(matchesAny("filter transactions", ["Customers can filter their transaction list"])).toBe(
      true,
    );
    expect(matchesAny("view transaction history", ["Customers can view transactions"])).toBe(false);
  });

  it("strips check wording from mustNotInvent phrases and defers 'named' ones to the judge", () => {
    expect(stripMeta("SMS notifications stated as explicit")).toBe("SMS notifications");
    expect(stripMeta("named KPIs (revenue, churn) stated as explicit")).toBe("named KPIs");
    expect(needsJudge("a named delivery app stated as explicit")).toBe(true);
    expect(needsJudge("SMS notifications")).toBe(false);
  });

  it("does not count a negated word as a match", () => {
    const negated = ["Claims with no injury go to auto-assessment"];
    expect(matchesAny("auto-assessment of injury claims", negated, true)).toBe(false);
    expect(matchesAny("auto-assessment of injury claims", negated)).toBe(true);
    expect(matchesAny("injury claims", ["Injury claims go to a handler"])).toBe(true);
  });

  it("scores recall per list and only counts EXPLICIT items as inventions", () => {
    const score = scoreDiscovery(fixture, output, 1, []);
    expect(score.requirements).toEqual({ matched: 1, total: 2, missed: ["download reports"] });
    expect(score.questionTopics.matched).toBe(1);
    expect(score.conflicts.matched).toBe(1);
    expect(score.inventions).toEqual([]); // SMS appears only as an ASSUMPTION
  });

  it("summarises and applies the blocking gates", () => {
    const good = scoreDiscovery(fixture, output, 1, []);
    const bad = scoreDiscovery(fixture, null, 2, ["invalid"]);
    expect(summarize([good]).gatesPass).toBe(true);
    expect(summarize([good, bad]).gatesPass).toBe(false);
  });
});
