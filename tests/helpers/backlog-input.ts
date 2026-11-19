import { runDemoPrd } from "@/src/ai/demo/prd-engine";
import type { StoryInput } from "@/src/ai/schemas/backlog";
import type { EvalFixture } from "@/tests/ai-evals/fixture-schema";

import { prdInputFor } from "./prd-input";

/** Story-stage input for a fixture: demo discovery → all-but-one approved → demo PRD v1. */
export function storyInputFor(fixture: EvalFixture): StoryInput {
  const prdInput = prdInputFor(fixture);
  const prd = runDemoPrd(prdInput);
  const requirements = prdInput.requirements.map((r) => ({
    code: r.code,
    text: r.text,
    type: r.type,
    evidence: r.evidence,
  }));
  return {
    project: prdInput.project,
    prd: {
      version: 1,
      summary: prd.summary,
      personas: prd.personas,
      inScope: prd.inScope,
      outOfScope: prd.outOfScope,
    },
    requirements,
    toCover: requirements.filter((r) => r.evidence !== "OPEN_QUESTION").map((r) => r.code),
    existingEpics: [],
    existingStories: [],
    rejected: [],
    nextStoryNumber: 1,
    nextEpicNumber: 1,
    target: null,
  };
}
