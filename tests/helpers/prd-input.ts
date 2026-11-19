import { runDemoDiscovery } from "@/src/ai/demo/discovery-engine";
import type { PrdInput } from "@/src/ai/schemas/prd";
import { nextCode } from "@/src/modules/requirements/repository";
import type { EvalFixture } from "@/tests/ai-evals/fixture-schema";

/** Discovery on the fixture, every requirement approved except the last one (rejected). */
export function prdInputFor(fixture: EvalFixture): PrdInput {
  const discovery = runDemoDiscovery({
    project: { name: `Fixture ${fixture.id}`, ...fixture.project },
    sources: [{ id: "s1", name: "Brief", text: fixture.input }],
    answers: [],
  });
  const coded: { code: string }[] = [];
  const requirements = discovery.requirements.map((r) => {
    const code = nextCode(coded, r.type);
    coded.push({ code });
    return { code, text: r.text, type: r.type, evidence: r.evidence, rationale: r.rationale };
  });
  const rejected = requirements.length > 2 ? [requirements.pop()!.text] : [];
  return {
    project: { name: `Fixture ${fixture.id}`, ...fixture.project, sprintLengthDays: 14 },
    discovery: {
      summary: discovery.summary,
      actors: discovery.actors,
      goals: discovery.goals,
      constraints: discovery.constraints,
    },
    requirements,
    rejected,
    clarifications: discovery.questions
      .slice(0, 2)
      .map((q) => ({ question: q.question, state: "skipped" as const, answer: null })),
    conflicts: discovery.conflicts.map((c) => ({
      description: c.description,
      question: c.question,
    })),
  };
}
