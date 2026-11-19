import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  dependencyCycles,
  missingCriteria,
  missingTasks,
  uncoveredRequirements,
} from "@/src/ai/orchestrator/rules";
import { outcome, runDemoQa } from "@/src/ai/demo/qa-engine";
import { applyNote, runDemoStories } from "@/src/ai/demo/story-engine";
import { storyPhrase } from "@/src/ai/demo/story-text";
import { runDemoTasks } from "@/src/ai/demo/task-engine";
import { QaOutput, StoryOutput, TaskOutput } from "@/src/ai/schemas/backlog";
import { storyPointsFromHours, storySentence, withArticle } from "@/src/modules/stories/schema";
import { EvalFixture } from "@/tests/ai-evals/fixture-schema";
import { storyInputFor } from "@/tests/helpers/backlog-input";

const fixture = (name: string) =>
  EvalFixture.parse(
    JSON.parse(
      readFileSync(new URL(`../../ai-evals/fixtures/${name}.json`, import.meta.url), "utf8"),
    ),
  );

function pipeline(name: string) {
  const input = storyInputFor(fixture(name));
  const stories = StoryOutput.parse(runDemoStories(input));
  const known = new Map(input.requirements.map((r) => [r.code, r]));
  const refs = stories.stories.map((s) => ({
    ...s,
    requirements: s.requirementCodes.map((c) => known.get(c)!),
  }));
  const qa = QaOutput.parse(
    runDemoQa({ project: input.project, stories: refs, note: null, storyIds: {} }),
  );
  const tasks = TaskOutput.parse(
    runDemoTasks({
      project: input.project,
      note: null,
      storyIds: {},
      stories: refs.map((s) => ({
        ...s,
        criteria: qa.criteria.filter((c) => c.storyCode === s.code),
      })),
    }),
  );
  return { input, stories, qa, tasks };
}

describe("demo story engine", () => {
  it("covers every approved requirement except open questions, with no cycles", () => {
    const { input, stories } = pipeline("001-transaction-dashboard");
    expect(uncoveredRequirements(stories.stories, input.toCover)).toEqual([]);
    expect(dependencyCycles(stories.stories)).toEqual([]);
    const notify = stories.stories.find((s) => /notifications/.test(s.iWant))!;
    expect(storySentence(notify)).toBe(
      "As a customer, I want to receive notifications for failed transactions so that I find out in time without having to keep checking.",
    );
    // The assumption about channels is a detail of the notification story, not a story of its own.
    expect(notify.requirementCodes.length).toBe(2);
    expect(stories.epics.map((e) => e.title)).toContain("Notifications");
  });

  it("attaches business rules to the story they constrain", () => {
    const { stories } = pipeline("004-leave-management");
    const leave = stories.stories.find((s) => /submit leave/.test(s.iWant))!;
    expect(leave.requirementCodes.length).toBeGreaterThan(2);
    const exportStory = stories.stories.find((s) => /export/.test(s.iWant))!;
    expect(exportStory.dependsOn).toContain(leave.code);
  });

  it("reads who and what from real-world wording", () => {
    expect(storyPhrase("We want customers to track their delivery live").iWant).toBe(
      "to track my delivery live",
    );
    expect(storyPhrase("Procurement reviews each application")).toMatchObject({
      actor: "procurement officer",
      iWant: "to review each application",
    });
    expect(storyPhrase("Manager gets notified and approves or rejects with a comment").iWant).toBe(
      "to get notified and approve or reject with a comment",
    );
    expect(storyPhrase("Free users should be capped at 3 projects so they upgrade")).toMatchObject({
      actor: "user",
      purpose: "they upgrade",
    });
    expect(storyPhrase("Must integrate with the existing policy admin system").iWant).toBe(
      "it to integrate with the existing policy admin system",
    );
    expect(storyPhrase("If nobody is home, the driver marks it failed").iWant).toBe(
      "to mark it failed if nobody is home",
    );
  });

  it("applies reviewer notes it understands and says when it can't", () => {
    const base = pipeline("001-transaction-dashboard").stories.stories[1]!;
    const noted = applyNote(
      base,
      "Write it as a support agent. Priority could-have.",
      "Regenerated with note",
    );
    expect([noted.asA, noted.priority]).toEqual(["support agent", "could"]);
    expect(noted.rationale).toContain("Applied: persona → support agent, priority → could");
    const vague = applyNote(base, "Make it punchier", "Regenerated with note");
    expect(vague.rationale).toContain("other notes need a connected model");
  });
});

describe("demo QA and task engines", () => {
  it("gives every story ≥ 2 criteria with a negative or edge case, and tasks with estimates", () => {
    for (const name of [
      "001-transaction-dashboard",
      "004-leave-management",
      "019-complex-supplier-onboarding-rfp",
    ]) {
      const { stories, qa, tasks } = pipeline(name);
      expect(missingCriteria(stories.stories, qa.criteria)).toEqual([]);
      expect(missingTasks(stories.stories, tasks.tasks)).toEqual([]);
      expect(tasks.estimates.length).toBe(stories.stories.length);
    }
  });

  it("turns attached rules into negative criteria", () => {
    const { stories, qa } = pipeline("004-leave-management");
    const leave = stories.stories.find((s) => /submit leave/.test(s.iWant))!;
    const rules = qa.criteria.filter(
      (c) => c.storyCode === leave.code && c.given.startsWith("the rule"),
    );
    expect(rules.length).toBeGreaterThan(1);
    expect(rules.every((c) => c.kind === "negative" && c.evidence === "EXPLICIT")).toBe(true);
  });

  it("phrases outcomes and articles correctly", () => {
    expect(outcome("annual plans to get 20% off")).toBe("annual plans get 20% off");
    expect(outcome("it to meet WCAG 2.1 AA")).toBe("it meets WCAG 2.1 AA");
    expect(outcome("account opening to be fully digital")).toBe("account opening is fully digital");
    expect(outcome("to sign in")).toBe("I can sign in");
    expect([withArticle("user"), withArticle("employee"), withArticle("HR manager")]).toEqual([
      "a user",
      "an employee",
      "an HR manager",
    ]);
  });

  it("maps hours to Fibonacci points and honours a pinned estimate", () => {
    expect([2, 6, 12, 20, 30, 50].map(storyPointsFromHours)).toEqual([1, 2, 3, 5, 8, 13]);
    const { input, stories, qa } = pipeline("001-transaction-dashboard");
    const known = new Map(input.requirements.map((r) => [r.code, r]));
    const s = stories.stories[0]!;
    const out = runDemoTasks({
      project: input.project,
      note: "This is 8 points",
      storyIds: {},
      stories: [
        {
          ...s,
          requirements: s.requirementCodes.map((c) => known.get(c)!),
          criteria: qa.criteria.filter((c) => c.storyCode === s.code),
        },
      ],
    });
    expect(out.estimates[0]!.storyPoints).toBe(8);
  });
});
