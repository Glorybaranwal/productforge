import { describe, expect, it } from "vitest";

import { renderReport } from "@/tests/ai-evals/report";
import { applyJudgeVerdicts, scoreDiscovery, summarize } from "@/tests/ai-evals/score";
import type { EvalFixture } from "@/tests/ai-evals/fixture-schema";
import type { DiscoveryOutput } from "@/src/modules/requirements/schema";
import { supportsTemperature } from "@/src/ai/openai-client";

const fixture: EvalFixture = {
  id: "901",
  category: "normal",
  project: { domain: "fintech", audience: "customers", teamSize: 3 },
  input: "Customers want to be told when a payment fails. They also export data.",
  expected: {
    requirements: ["alert on failed payments", "export data", "reset password"],
    questionsAbout: [],
    conflicts: [],
    ambiguousTerms: [],
    mustNotInvent: [],
  },
};

const output: DiscoveryOutput = {
  summary: "s",
  requirements: [
    {
      text: "Notify customers when a payment fails",
      type: "functional",
      evidence: "EXPLICIT",
      sourceQuote: "q",
      sourceId: "s1",
      rationale: null,
    },
    {
      text: "Customers can export data",
      type: "functional",
      evidence: "EXPLICIT",
      sourceQuote: "q",
      sourceId: "s1",
      rationale: null,
    },
  ],
  actors: [],
  goals: [],
  constraints: [],
  questions: [{ question: "Q?", reason: "r" }],
  conflicts: [],
  ambiguities: [],
};

describe("tier tracking", () => {
  const tier1 = scoreDiscovery(fixture, output, 1, []);

  it("records which tier matched each expected phrase", () => {
    expect(tier1.items.map((i) => [i.phrase, i.tier])).toEqual([
      ["alert on failed payments", null],
      ["export data", 1],
      ["reset password", null],
    ]);
    expect(tier1.requirements.matched).toBe(1);
  });

  it("counts Tier 2 matches in recall and keeps the item id and reason", () => {
    const judged = applyJudgeVerdicts(tier1, "requirement", [
      { phrase: "alert on failed payments", match: true, outputItemId: "R1", reason: "paraphrase" },
      { phrase: "reset password", match: false, outputItemId: null, reason: "absent" },
    ]);
    expect(judged.requirements).toEqual({ matched: 2, total: 3, missed: ["reset password"] });
    expect(judged.items[0]).toMatchObject({ tier: 2, outputItemId: "R1", reason: "paraphrase" });
    expect(judged.items[1]?.tier).toBe(1);
    expect(summarize([judged]).requirementRecall).toBe(2 / 3);
  });

  it("prints the tier per item and says why Tier 2 did not run", () => {
    const judged = applyJudgeVerdicts(tier1, "requirement", [
      { phrase: "alert on failed payments", match: true, outputItemId: "R1", reason: "paraphrase" },
    ]);
    const meta = { provider: "p", model: "gpt-4.1", date: "2026-11-22", quick: false };
    const full = renderReport(summarize([judged]), [judged], { ...meta, tier2: "ran" });
    expect(full).toContain("judge.v1");
    expect(full).toContain("| Requirement | alert on failed payments | Tier 2 → R1: paraphrase |");
    expect(full).toContain("| Requirement | export data | Tier 1 |");
    expect(full).toContain("| Requirement | reset password | missed |");
    expect(full).not.toContain("no LLM judge yet");
    expect(full).toContain("(`judge.v1`, temperature 0)");
    const reasoning = renderReport(summarize([judged]), [judged], {
      ...meta,
      model: "gpt-5-mini",
      tier2: "ran",
    });
    expect(reasoning).toContain(
      "model default temperature — gpt-5 and o-series models don't accept a temperature",
    );
    expect(reasoning).not.toContain("temperature 0)");
    const quick = renderReport(summarize([tier1]), [tier1], {
      ...meta,
      quick: true,
      tier2: "quick",
    });
    expect(quick).toContain("Tier 2 skipped (quick run)");
    const demo = renderReport(summarize([tier1]), [tier1], { ...meta, tier2: "demo" });
    expect(demo).toContain("Tier 2 skipped (demo engine)");
  });
});

describe("supportsTemperature", () => {
  it("is false for gpt-5 and o-series models, true otherwise", () => {
    for (const m of ["gpt-5", "gpt-5-mini", "o1", "o3-mini", "o4-mini"])
      expect(supportsTemperature(m)).toBe(false);
    for (const m of ["gpt-4.1", "gpt-4o-mini", "omni-test", "test-model"])
      expect(supportsTemperature(m)).toBe(true);
  });
});
