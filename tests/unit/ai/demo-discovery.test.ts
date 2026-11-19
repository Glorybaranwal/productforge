import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runDemoDiscovery } from "@/src/ai/demo/discovery-engine";
import { ANSWERS_SOURCE_ID, type DiscoveryInput } from "@/src/ai/schemas/discovery";
import { discoveryRules } from "@/src/ai/stages/discovery.stage";
import { DiscoveryOutput } from "@/src/modules/requirements/schema";
import { EvalFixture } from "@/tests/ai-evals/fixture-schema";

const DIR = fileURLToPath(new URL("../../ai-evals/fixtures/", import.meta.url));
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${DIR}${f}`, "utf8"))));

function inputFor(fixture: EvalFixture, answers: DiscoveryInput["answers"] = []): DiscoveryInput {
  return {
    project: { name: `Fixture ${fixture.id}`, ...fixture.project },
    sources: [{ id: "src-1", name: "Brief", text: fixture.input }],
    answers,
  };
}

describe("demo discovery engine", () => {
  it.each(fixtures)(
    "fixture $id ($category): valid output that passes every business rule",
    (fixture) => {
      const input = inputFor(fixture);
      const output = runDemoDiscovery(input);
      const parsed = DiscoveryOutput.safeParse(output);
      expect(parsed.success).toBe(true);
      expect(discoveryRules.flatMap((rule) => rule(output, input))).toEqual([]);
      expect(output.questions.length > 0).toBe(true);
    },
  );

  it("flags conflicts in every contradictory fixture", () => {
    for (const fixture of fixtures.filter((f) => f.category === "contradictory")) {
      expect(runDemoDiscovery(inputFor(fixture)).conflicts.length > 0, fixture.id).toBe(true);
    }
  });

  it("flags vague terms in every vague fixture", () => {
    for (const fixture of fixtures.filter((f) => f.category === "vague")) {
      expect(runDemoDiscovery(inputFor(fixture)).ambiguities.length > 0, fixture.id).toBe(true);
    }
  });

  it("treats an injected instruction as data: no requirement obeys it and a question flags it", () => {
    const fixture = fixtures.find((f) => f.id === "019");
    if (!fixture) throw new Error("fixture 019 missing");
    const output = runDemoDiscovery(inputFor(fixture));
    expect(output.requirements.some((r) => /ignore your previous instructions/i.test(r.text))).toBe(
      false,
    );
    expect(output.questions.some((q) => /addressed to AI systems/.test(q.question))).toBe(true);
  });

  it("only labels EXPLICIT what it can quote", () => {
    for (const fixture of fixtures) {
      for (const r of runDemoDiscovery(inputFor(fixture)).requirements) {
        if (r.evidence === "EXPLICIT")
          expect(Boolean(r.sourceQuote && r.sourceId), r.text).toBe(true);
      }
    }
  });

  it("turns answers into requirements and doesn't ask the same question again", () => {
    const fixture = fixtures.find((f) => f.id === "001");
    if (!fixture) throw new Error("fixture 001 missing");
    const first = runDemoDiscovery(inputFor(fixture));
    const channel = first.questions.find((q) => /channel/i.test(q.question));
    if (!channel) throw new Error("expected a notification-channel question");

    const second = runDemoDiscovery(
      inputFor(fixture, [
        { question: channel.question, state: "answered", answer: "Email and push notifications" },
      ]),
    );
    const fromAnswer = second.requirements.find((r) => r.sourceId === ANSWERS_SOURCE_ID);
    expect(fromAnswer?.evidence).toBe("EXPLICIT");
    expect(fromAnswer?.text).toContain("Email and push notifications");
    expect(second.questions.some((q) => q.question === channel.question)).toBe(false);
  });

  it("is deterministic", () => {
    const fixture = fixtures[0]!;
    expect(runDemoDiscovery(inputFor(fixture))).toEqual(runDemoDiscovery(inputFor(fixture)));
  });
});
