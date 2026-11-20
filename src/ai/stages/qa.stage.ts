import type { Stage } from "@/src/ai/orchestrator/run-stage";
import { messages, missingCriteria } from "@/src/ai/orchestrator/rules";
import {
  QaOutput,
  type BacklogStoryRef,
  type QaInput,
  type RequirementRef,
} from "@/src/ai/schemas/backlog";
import { AppError } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { backlogRepository } from "@/src/modules/stories/repository";
import type { Story } from "@/src/modules/stories/schema";
import { loadBacklog, requireGate2, type BacklogContext } from "@/src/modules/stories/state";

import { block } from "./blocks";

export type ChildStageOptions = { storyIds?: string[]; note?: string };

/** The stories a QA or task run works on: the given ones, or every draft missing `missing`. */
export function selectStories(
  b: BacklogContext,
  options: ChildStageOptions,
  missing: "criteria" | "tasks",
): Story[] {
  const drafts = b.current.filter((s) => s.status === "DRAFT");
  const picked = options.storyIds
    ? drafts.filter((s) => options.storyIds!.includes(s.id))
    : drafts.filter((s) => !b.rows[missing].some((c) => c.storyId === s.id));
  if (picked.length === 0) throw new AppError("CONFLICT", `No draft stories need ${missing}`);
  return picked;
}

export function storyRef(s: Story, b: BacklogContext): BacklogStoryRef {
  const known = new Map(b.approved.map((r) => [r.code, r]));
  return {
    code: s.code,
    title: s.title,
    asA: s.asA,
    iWant: s.iWant,
    soThat: s.soThat,
    requirements: s.requirementCodes
      .map((c) => known.get(c))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r): RequirementRef => ({
        code: r.code,
        text: r.text,
        type: r.type,
        evidence: r.evidence,
      })),
  };
}

export function projectRef(b: BacklogContext) {
  const p = b.project;
  return {
    name: p.name,
    domain: p.domain,
    audience: p.audience,
    teamSize: p.teamSize,
    sprintLengthDays: p.sprintLengthDays,
  };
}

export function renderStories(
  stories: (BacklogStoryRef & {
    criteria?: { kind: string; given: string; when: string; then: string }[];
  })[],
): string {
  return stories
    .map((s) =>
      [
        `${s.code} ${s.title}: As a ${s.asA}, I want ${s.iWant} so that ${s.soThat}.`,
        ...s.requirements.map(
          (r) =>
            `  ${r.code} [${r.evidence}${r.type === "non_functional" ? ", non-functional" : ""}] ${r.text}`,
        ),
        ...(s.criteria ?? []).map(
          (c) => `  (${c.kind}) Given ${c.given}; when ${c.when}; then ${c.then}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

export const qaRules: ((o: QaOutput, i: QaInput) => string[])[] = [
  (o, i) => {
    const codes = new Set(i.stories.map((s) => s.code));
    return o.criteria
      .filter((c) => !codes.has(c.storyCode))
      .map((c) => `Criterion for unknown story ${c.storyCode}`);
  },
  (o, i) => messages(missingCriteria(i.stories, o.criteria)),
];

/** QA stage (PF-040): Given/When/Then criteria for draft stories. */
export function qaStage(options: ChildStageOptions = {}): Stage<QaInput, QaOutput> {
  return {
    name: "qa",
    promptFile: "qa.v1.md",
    outputSchema: QaOutput,

    async loadContext({ ctx, projectId }) {
      const b = await loadBacklog(ctx, projectId);
      requireGate2(b);
      const stories = selectStories(b, options, "criteria");
      return {
        project: projectRef(b),
        stories: stories.map((s) => storyRef(s, b)),
        note: options.note?.trim() || null,
        storyIds: Object.fromEntries(stories.map((s) => [s.code, s.id])),
      };
    },

    renderPrompt(input) {
      return [
        `Project: ${input.project.name} · ${input.project.domain} · for ${input.project.audience}`,
        "",
        block("stories", renderStories(input.stories)),
        ...(input.note ? ["", block("note", input.note)] : []),
      ].join("\n");
    },

    businessRules: qaRules,

    async persist(output, input, { ctx, projectId }, run) {
      const now = nowIso();
      for (const [code, storyId] of Object.entries(input.storyIds)) {
        const criteria = output.criteria
          .filter((c) => c.storyCode === code)
          .map((c, position) => ({
            id: newId(),
            workspaceId: ctx.workspace.id,
            projectId,
            storyId,
            kind: c.kind,
            given: c.given,
            when: c.when,
            then: c.then,
            position,
            status: "DRAFT" as const,
            evidence: c.evidence,
            origin: "ai" as const,
            agentRunId: run.id,
            createdAt: now,
            updatedAt: now,
          }));
        await backlogRepository.replaceChildren(ctx, storyId, { criteria });
      }
    },
  };
}
