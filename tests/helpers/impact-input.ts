import { runDemoPrd } from "@/src/ai/demo/prd-engine";
import { runDemoQa } from "@/src/ai/demo/qa-engine";
import { runDemoStories } from "@/src/ai/demo/story-engine";
import { runDemoTasks } from "@/src/ai/demo/task-engine";
import type { QaInput, StoryInput, TaskInput } from "@/src/ai/schemas/backlog";
import type { Candidates } from "@/src/modules/impact/candidates";
import { storySentence } from "@/src/modules/stories/schema";
import type { EvalFixture } from "@/tests/ai-evals/fixture-schema";

import { storyInputFor } from "./backlog-input";
import { prdInputFor } from "./prd-input";

export type Built = {
  requirements: StoryInput["requirements"];
  candidatesFor: (code: string | null) => Candidates;
};

/** A fixture's demo backlog (stories, criteria, tasks) and the impact candidates for any requirement. */
export function buildFixtureBacklog(fixture: EvalFixture): Built {
  const input = storyInputFor(fixture);
  const prd = runDemoPrd(prdInputFor(fixture));
  const stories = runDemoStories(input).stories;
  const known = new Map(input.requirements.map((r) => [r.code, r]));
  const refs = stories.map((s) => ({
    ...s,
    requirements: s.requirementCodes.flatMap((c) => known.get(c) ?? []),
  }));
  const qaInput: QaInput = { project: input.project, stories: refs, note: null, storyIds: {} };
  const criteria = runDemoQa(qaInput).criteria;
  const taskInput: TaskInput = {
    project: input.project,
    note: null,
    storyIds: {},
    stories: refs.map((s) => ({ ...s, criteria: criteria.filter((c) => c.storyCode === s.code) })),
  };
  const tasks = runDemoTasks(taskInput).tasks;
  const taskRef = new Map(tasks.map((t, i) => [t, `TASK-${String(i + 1).padStart(3, "0")}`]));
  const traced = [
    ...prd.functionalRequirements,
    ...prd.nonFunctionalRequirements,
    ...prd.assumptions,
    ...prd.openQuestions,
  ];
  return {
    requirements: input.requirements,
    candidatesFor: (code) => ({
      prd: {
        version: 1,
        lines: code
          ? traced.filter((t) => t.requirementCodes.includes(code)).map((t) => t.text)
          : [],
      },
      stories: code
        ? stories
            .filter((s) => s.requirementCodes.includes(code))
            .map((s) => ({
              code: s.code,
              title: s.title,
              sentence: storySentence(s),
              status: "APPROVED" as const,
              version: 1,
              otherRequirements: s.requirementCodes.filter((c) => c !== code),
              sprint: null,
              criteria: criteria
                .filter((c) => c.storyCode === s.code)
                .map((c, i) => ({
                  ref: `${s.code}/AC-${i + 1}`,
                  kind: c.kind,
                  given: c.given,
                  when: c.when,
                  then: c.then,
                })),
              tasks: tasks
                .filter((t) => t.storyCode === s.code)
                .map((t) => ({ ref: taskRef.get(t)!, title: t.title })),
            }))
        : [],
    }),
  };
}
