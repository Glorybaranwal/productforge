import type { Stage } from "@/src/ai/orchestrator/run-stage";
import { messages, missingTasks } from "@/src/ai/orchestrator/rules";
import { TaskOutput, type TaskInput } from "@/src/ai/schemas/backlog";
import { newId, nowIso } from "@/src/lib/ids";
import { backlogRepository } from "@/src/modules/stories/repository";
import { formatCode, nextNumber } from "@/src/modules/stories/schema";
import { loadBacklog, requireGate2 } from "@/src/modules/stories/state";

import { block } from "./blocks";
import {
  projectRef,
  renderStories,
  selectStories,
  storyRef,
  type ChildStageOptions,
} from "./qa.stage";

export const taskRules: ((o: TaskOutput, i: TaskInput) => string[])[] = [
  (o, i) => {
    const codes = new Set(i.stories.map((s) => s.code));
    return [
      ...o.tasks
        .filter((t) => !codes.has(t.storyCode))
        .map((t) => `Task for unknown story ${t.storyCode}`),
      ...o.estimates
        .filter((e) => !codes.has(e.storyCode))
        .map((e) => `Estimate for unknown story ${e.storyCode}`),
    ];
  },
  (o, i) => messages(missingTasks(i.stories, o.tasks)),
  (o, i) =>
    i.stories
      .filter((s) => o.estimates.filter((e) => e.storyCode === s.code).length !== 1)
      .map((s) => `${s.code} needs exactly one story-point estimate`),
];

/** Task stage (PF-041): technical tasks with hour estimates, and story points. */
export function taskStage(options: ChildStageOptions = {}): Stage<TaskInput, TaskOutput> {
  return {
    name: "task",
    promptFile: "task.v1.md",
    outputSchema: TaskOutput,

    async loadContext({ ctx, projectId }) {
      const b = await loadBacklog(ctx, projectId);
      requireGate2(b);
      const stories = selectStories(b, options, "tasks");
      return {
        project: projectRef(b),
        stories: stories.map((s) => ({
          ...storyRef(s, b),
          criteria: b.rows.criteria
            .filter((c) => c.storyId === s.id)
            .map((c) => ({ kind: c.kind, given: c.given, when: c.when, then: c.then })),
        })),
        note: options.note?.trim() || null,
        storyIds: Object.fromEntries(stories.map((s) => [s.code, s.id])),
      };
    },

    renderPrompt(input) {
      return [
        `Project: ${input.project.name} · ${input.project.domain} · for ${input.project.audience}`,
        `Team: ${input.project.teamSize} people · ${input.project.sprintLengthDays}-day sprints`,
        "",
        block("stories", renderStories(input.stories)),
        ...(input.note ? ["", block("note", input.note)] : []),
      ].join("\n");
    },

    businessRules: taskRules,

    async persist(output, input, { ctx, projectId }, run) {
      const ws = ctx.workspace.id;
      const rows = await backlogRepository.load(ctx, projectId);
      let next = nextNumber(
        rows.tasks.map((t) => t.code),
        "TASK",
      );
      const now = nowIso();
      for (const [code, storyId] of Object.entries(input.storyIds)) {
        const story = rows.stories.find((s) => s.id === storyId);
        const tasks = output.tasks
          .filter((t) => t.storyCode === code)
          .map((t, position) => ({
            id: newId(),
            workspaceId: ws,
            projectId,
            storyId,
            code: formatCode("TASK", next++, 3),
            title: t.title,
            description: t.description,
            estimateHours: t.estimateHours,
            position,
            sprintId: null,
            status: "DRAFT" as const,
            evidence: "INFERRED" as const,
            origin: "ai" as const,
            agentRunId: run.id,
            createdAt: now,
            updatedAt: now,
          }));
        const points = output.estimates.find((e) => e.storyCode === code)?.storyPoints ?? null;
        await backlogRepository.replaceChildren(
          ctx,
          storyId,
          { tasks },
          story?.storyPoints === null && points !== null ? { storyPoints: points } : {},
        );
      }
    },
  };
}
