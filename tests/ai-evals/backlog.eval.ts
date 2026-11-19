/**
 * Backlog eval (PF-034 "coverage ≥ 90 % on fixtures", PF-040, PF-041). Runs story → QA → task on
 * the quick set. Input comes from the deterministic demo discovery and PRD, so the score isolates
 * these three stages.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

import { getLLMClient, type LLMClient } from "@/src/ai/llm-client";
import { criterionFlags, dependencyCycles } from "@/src/ai/orchestrator/rules";
import { loadPrompt } from "@/src/ai/prompts/load";
import {
  QaOutput,
  StoryOutput,
  TaskOutput,
  type QaInput,
  type TaskInput,
} from "@/src/ai/schemas/backlog";
import { qaRules, qaStage } from "@/src/ai/stages/qa.stage";
import { storyRules, storyStage } from "@/src/ai/stages/story.stage";
import { taskRules, taskStage } from "@/src/ai/stages/task.stage";
import { zodFieldErrors } from "@/src/lib/errors";
import { storyInputFor } from "@/tests/helpers/backlog-input";

import { EvalFixture } from "./fixture-schema";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const REPORTS = fileURLToPath(new URL("./reports/", import.meta.url));

/** One stage call with the runner's retry-once-with-feedback behaviour. */
async function call<I, O>(
  llm: LLMClient,
  name: string,
  system: string,
  prompt: string,
  input: I,
  schema: z.ZodType<O>,
  rules: ((o: O, i: I) => string[])[],
): Promise<{ output: O | null; attempts: number; problems: string[] }> {
  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await llm.generateStructured({
      name,
      system,
      prompt,
      data: input,
      schema,
      feedback,
    });
    const parsed = schema.safeParse(result.data);
    const problems = parsed.success
      ? rules.flatMap((rule) => rule(parsed.data, input))
      : zodFieldErrors(parsed.error).map((e) => `${e.path}: ${e.message}`);
    if (parsed.success && problems.length === 0)
      return { output: parsed.data, attempts: attempt, problems: [] };
    feedback = problems;
  }
  return { output: null, attempts: 2, problems: feedback ?? [] };
}

type Row = {
  id: string;
  valid: boolean;
  stories: number;
  epics: number;
  coverage: [number, number];
  criteria: number;
  vague: number;
  tasks: number;
  points: number;
  problems: string[];
};

describe("Backlog eval (quick set)", () => {
  it("writes traced stories with testable criteria and estimated tasks", async () => {
    const llm = getLLMClient();
    const prompts = {
      story: await loadPrompt("story.v1.md"),
      qa: await loadPrompt("qa.v1.md"),
      task: await loadPrompt("task.v1.md"),
    };
    const fixtures = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => EvalFixture.parse(JSON.parse(readFileSync(`${FIXTURES}${f}`, "utf8"))))
      .filter((f) => f.quick);

    const rows: Row[] = [];
    for (const fixture of fixtures) {
      const input = storyInputFor(fixture);
      const row: Row = {
        id: fixture.id,
        valid: true,
        stories: 0,
        epics: 0,
        coverage: [0, input.toCover.length],
        criteria: 0,
        vague: 0,
        tasks: 0,
        points: 0,
        problems: [],
      };
      if (input.toCover.length === 0) {
        row.problems.push("nothing to cover (only open questions)");
        rows.push(row);
        continue;
      }
      const s = await call(
        llm,
        "story",
        prompts.story,
        storyStage().renderPrompt(input),
        input,
        StoryOutput,
        storyRules,
      );
      if (!s.output) {
        rows.push({ ...row, valid: false, problems: s.problems.slice(0, 2) });
        continue;
      }
      const known = new Map(input.requirements.map((r) => [r.code, r]));
      const refs = s.output.stories.map((st) => ({
        ...st,
        requirements: st.requirementCodes.flatMap((c) => known.get(c) ?? []),
      }));
      const linked = new Set(s.output.stories.flatMap((st) => st.requirementCodes));
      row.stories = s.output.stories.length;
      row.epics = new Set(s.output.stories.map((st) => st.epicCode)).size;
      row.coverage = [input.toCover.filter((c) => linked.has(c)).length, input.toCover.length];
      if (dependencyCycles(s.output.stories).length) row.problems.push("dependency cycle");

      const qaInput: QaInput = { project: input.project, stories: refs, note: null, storyIds: {} };
      const q = await call(
        llm,
        "qa",
        prompts.qa,
        qaStage().renderPrompt(qaInput),
        qaInput,
        QaOutput,
        qaRules,
      );
      if (!q.output) {
        rows.push({ ...row, valid: false, problems: q.problems.slice(0, 2) });
        continue;
      }
      row.criteria = q.output.criteria.length;
      row.vague = q.output.criteria.filter((c) => criterionFlags(c).length).length;

      const taskInput: TaskInput = {
        project: input.project,
        note: null,
        storyIds: {},
        stories: refs.map((st) => ({
          ...st,
          criteria: q.output!.criteria.filter((c) => c.storyCode === st.code),
        })),
      };
      const t = await call(
        llm,
        "task",
        prompts.task,
        taskStage().renderPrompt(taskInput),
        taskInput,
        TaskOutput,
        taskRules,
      );
      if (!t.output) {
        rows.push({ ...row, valid: false, problems: t.problems.slice(0, 2) });
        continue;
      }
      row.tasks = t.output.tasks.length;
      row.points = t.output.estimates.reduce((n, e) => n + e.storyPoints, 0);
      rows.push(row);
    }

    const scored = rows.filter((r) => r.coverage[1] > 0);
    const covered = scored.reduce((n, r) => n + r.coverage[0], 0);
    const required = scored.reduce((n, r) => n + r.coverage[1], 0);
    const coverage = required ? covered / required : 1;
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(REPORTS, { recursive: true });
    const file = `${REPORTS}${date}-backlog-${llm.provider}.md`;
    writeFileSync(
      file,
      [
        `# Backlog eval — ${date} (quick set)`,
        "",
        `Provider: **${llm.provider}** · model: \`${llm.model}\`. Input: deterministic demo discovery and PRD; every requirement but one approved.`,
        "",
        `- **Requirement-to-story coverage: ${pct(coverage)}** (${covered}/${required}; PF-034 gate: ≥ 90 %). Open questions are excluded — they wait for an answer.`,
        `- **Schema-valid and passing the business rules: ${rows.filter((r) => r.valid).length}/${rows.length}** (story, QA and task stages; ≥ 2 criteria per story incl. a negative or edge case; every story has estimated tasks).`,
        `- Criteria flagged as vague: ${rows.reduce((n, r) => n + r.vague, 0)} of ${rows.reduce((n, r) => n + r.criteria, 0)} (warnings shown to the PM; vague requirements produce vague checks until clarified).`,
        "",
        "| Fixture | Valid | Epics | Stories | Coverage | Criteria | Vague | Tasks | Points | Notes |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows.map(
          (r) =>
            `| ${r.id} | ${r.valid ? "✓" : "✗"} | ${r.epics} | ${r.stories} | ${r.coverage[0]}/${r.coverage[1]} | ${r.criteria} | ${r.vague} | ${r.tasks} | ${r.points} | ${r.problems.join("; ") || "–"} |`,
        ),
        "",
      ].join("\n"),
    );
    console.log(`Eval report: ${file}`);
    expect(rows.every((r) => r.valid)).toBe(true);
    expect(coverage).toBeGreaterThanOrEqual(0.9);
  }, 900_000);
});
