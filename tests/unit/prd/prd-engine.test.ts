import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runDemoPrd } from "@/src/ai/demo/prd-engine";
import { prdRules } from "@/src/ai/stages/prd.stage";
import { PrdContent } from "@/src/modules/prd/schema";
import { EvalFixture } from "@/tests/ai-evals/fixture-schema";
import { prdInputFor } from "@/tests/helpers/prd-input";

const DIR = fileURLToPath(new URL("../../ai-evals/fixtures/", import.meta.url));
const quick = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${DIR}${f}`, "utf8"))))
  .filter((f) => f.quick);

describe("demo PRD engine", () => {
  it.each(quick)(
    "fixture $id: schema-valid PRD that covers every approved requirement",
    (fixture) => {
      const input = prdInputFor(fixture);
      const prd = runDemoPrd(input);
      expect(PrdContent.safeParse(prd).success).toBe(true);
      expect(prdRules.flatMap((rule) => rule(prd, input))).toEqual([]);
    },
  );

  it("puts assumptions and open questions in their own sections, with their codes", () => {
    const input = prdInputFor(quick.find((f) => f.id === "001")!);
    const prd = runDemoPrd(input);
    for (const r of input.requirements) {
      const section =
        r.evidence === "ASSUMPTION"
          ? prd.assumptions
          : r.evidence === "OPEN_QUESTION"
            ? prd.openQuestions
            : null;
      if (section)
        expect(
          section.some((i) => i.requirementCodes.includes(r.code)),
          r.code,
        ).toBe(true);
    }
    expect(prd.openQuestions.some((q) => q.text.startsWith("Skipped during clarification"))).toBe(
      true,
    );
  });

  it("lists rejected requirements as out of scope, never in scope", () => {
    const input = prdInputFor(quick.find((f) => f.id === "001")!);
    const prd = runDemoPrd(input);
    expect(prd.outOfScope.some((s) => s.includes(input.rejected[0]!.replace(/[.]+$/, "")))).toBe(
      true,
    );
  });

  it("flags drafted content as an assumption to confirm", () => {
    const prd = runDemoPrd(prdInputFor(quick[0]!));
    expect(prd.assumptions.some((a) => /drafted from the approved requirements/.test(a.text))).toBe(
      true,
    );
    expect(prd.goals.every((g) => g.metric.length > 0)).toBe(true);
  });
});
