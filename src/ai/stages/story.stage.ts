import type { Stage } from "@/src/ai/orchestrator/run-stage";
import {
  dependencyCycles,
  duplicateCodes,
  messages,
  orphanStories,
  uncoveredRequirements,
  unknownDependencies,
} from "@/src/ai/orchestrator/rules";
import { StoryOutput, type StoryInput } from "@/src/ai/schemas/backlog";
import { AppError } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { backlogRepository } from "@/src/modules/stories/repository";
import { formatCode, nextNumber, type Epic, type Story } from "@/src/modules/stories/schema";
import { linkedBy, loadBacklog, requireGate2, requiredCodes } from "@/src/modules/stories/state";

import { block } from "./blocks";

export type StoryStageOptions = { targetId?: string; note?: string };

export const storyRules: ((o: StoryOutput, i: StoryInput) => string[])[] = [
  (o) => messages(duplicateCodes(o.stories, "Story code")),
  (o, i) => {
    if (i.target) {
      return o.stories.length === 1 && o.stories[0]!.code === i.target.code
        ? []
        : [`Return exactly one story, with code ${i.target.code}`];
    }
    const taken = new Set([...i.existingStories, ...i.rejected].map((s) => s.code));
    return o.stories
      .filter((s) => taken.has(s.code) || Number(s.code.slice(3)) < i.nextStoryNumber)
      .map(
        (s) =>
          `${s.code} is already used — new stories start at ${formatCode("US", i.nextStoryNumber, 3)}`,
      );
  },
  (o, i) => {
    const existing = new Set(i.existingEpics.map((e) => e.code));
    const added = new Set(o.epics.map((e) => e.code));
    return [
      ...o.epics
        .filter((e) => existing.has(e.code))
        .map((e) => `Epic ${e.code} already exists — use it or a new code`),
      ...o.stories
        .filter((s) => !existing.has(s.epicCode) && !added.has(s.epicCode))
        .map((s) => `${s.code} uses unknown epic ${s.epicCode}`),
      ...o.epics
        .filter((e) => !o.stories.some((s) => s.epicCode === e.code))
        .map((e) => `Epic ${e.code} has no stories`),
    ];
  },
  (o, i) =>
    messages(
      orphanStories(
        o.stories,
        i.requirements.map((r) => r.code),
      ),
    ),
  (o, i) => messages(uncoveredRequirements(o.stories, i.toCover)),
  (o, i) => {
    const kept = i.existingStories.filter((s) => s.code !== i.target?.code);
    const graph = [...kept, ...o.stories];
    return messages([
      ...unknownDependencies(
        o.stories,
        graph.map((s) => s.code),
      ),
      ...dependencyCycles(graph),
    ]);
  },
];

/** Story stage (PF-034): fills coverage gaps, or rewrites one story with a reviewer note. */
export function storyStage(options: StoryStageOptions = {}): Stage<StoryInput, StoryOutput> {
  return {
    name: "story",
    promptFile: "story.v1.md",
    outputSchema: StoryOutput,

    async loadContext({ ctx, projectId }) {
      const b = await loadBacklog(ctx, projectId);
      const prd = requireGate2(b);
      const content = prd.content;
      const epicOf = (s: Story) => b.epicCode.get(s.epicId) ?? "EP-01";
      const target = options.targetId
        ? b.current.find((s) => s.id === options.targetId)
        : undefined;
      if (options.targetId && (!target || target.status === "APPROVED")) {
        throw new AppError(
          "CONFLICT",
          "Only the current draft or rejected version of a story can be regenerated",
        );
      }
      const live = b.current.filter((s) => s.status !== "REJECTED");
      const covered = linkedBy(live);
      return {
        project: {
          name: b.project.name,
          domain: b.project.domain,
          audience: b.project.audience,
          teamSize: b.project.teamSize,
          sprintLengthDays: b.project.sprintLengthDays,
        },
        prd: {
          version: prd.version,
          summary: content.summary,
          personas: content.personas,
          inScope: content.inScope,
          outOfScope: content.outOfScope,
        },
        requirements: b.approved.map((r) => ({
          code: r.code,
          text: r.text,
          type: r.type,
          evidence: r.evidence,
        })),
        toCover: target ? [] : requiredCodes(b.approved).filter((c) => !covered.has(c)),
        existingEpics: b.rows.epics.map((e) => ({ code: e.code, title: e.title })),
        existingStories: live.map((s) => ({
          code: s.code,
          epicCode: epicOf(s),
          title: s.title,
          requirementCodes: s.requirementCodes,
          dependsOn: s.dependsOn,
        })),
        rejected: b.current
          .filter((s) => s.status === "REJECTED" && s.id !== target?.id)
          .map((s) => ({
            code: s.code,
            title: s.title,
            requirementCodes: s.requirementCodes,
            reason: s.rejectionReason ?? "",
          })),
        nextStoryNumber: nextNumber(
          b.rows.stories.map((s) => s.code),
          "US",
        ),
        nextEpicNumber: nextNumber(
          b.rows.epics.map((e) => e.code),
          "EP",
        ),
        target: target
          ? {
              code: target.code,
              epicCode: epicOf(target),
              title: target.title,
              asA: target.asA,
              iWant: target.iWant,
              soThat: target.soThat,
              priority: target.priority,
              requirementCodes: target.requirementCodes,
              dependsOn: target.dependsOn,
              note: options.note ?? target.rejectionReason ?? "",
            }
          : null,
      };
    },

    renderPrompt(input) {
      const reqs = input.requirements
        .map(
          (r) =>
            `${r.code} [${r.evidence}${r.type === "non_functional" ? ", non-functional" : ""}] ${r.text}`,
        )
        .join("\n");
      const backlog = input.existingStories
        .map((s) => `${s.code} (${s.epicCode}) ${s.title} → ${s.requirementCodes.join(", ")}`)
        .join("\n");
      return [
        `Project: ${input.project.name} · ${input.project.domain} · for ${input.project.audience}`,
        `Team: ${input.project.teamSize} people · ${input.project.sprintLengthDays}-day sprints`,
        "",
        block(
          "prd",
          [
            `Approved PRD version ${input.prd.version}. ${input.prd.summary}`,
            `Personas: ${input.prd.personas.map((p) => `${p.name} (${p.needs})`).join("; ")}`,
            `In scope: ${input.prd.inScope.join(" | ")}`,
            `Out of scope: ${input.prd.outOfScope.join(" | ") || "none"}`,
          ].join("\n"),
        ),
        "",
        block("requirements", reqs),
        "",
        block(
          "existing_backlog",
          `Epics: ${input.existingEpics.map((e) => `${e.code} ${e.title}`).join(" | ") || "none"}\n${backlog || "No stories yet."}`,
        ),
        "",
        block(
          "rejected",
          input.rejected
            .map(
              (r) => `${r.code} ${r.title} → ${r.requirementCodes.join(", ")}. Reason: ${r.reason}`,
            )
            .join("\n") || "none",
        ),
        "",
        input.target
          ? block(
              "target",
              `Rewrite ${input.target.code} (${input.target.epicCode}): ${input.target.title}. As a ${input.target.asA}, I want ${input.target.iWant} so that ${input.target.soThat}. Links: ${input.target.requirementCodes.join(", ")}.\nReviewer note: ${input.target.note || "none"}`,
            )
          : `To cover: ${input.toCover.join(", ")}. New stories start at ${formatCode("US", input.nextStoryNumber, 3)}; new epics at ${formatCode("EP", input.nextEpicNumber, 2)}.`,
      ].join("\n");
    },

    businessRules: storyRules,

    async persist(output, input, { ctx, projectId }, run) {
      const ws = ctx.workspace.id;
      const rows = await backlogRepository.load(ctx, projectId);
      const now = nowIso();
      const epicIds = new Map(rows.epics.map((e) => [e.code, e.id]));
      const epics: Epic[] = output.epics.map((e) => {
        const id = newId();
        epicIds.set(e.code, id);
        return {
          id,
          workspaceId: ws,
          projectId,
          code: e.code,
          title: e.title,
          description: e.description,
          status: "DRAFT",
          evidence: "INFERRED",
          origin: "ai",
          agentRunId: run.id,
          createdAt: now,
          updatedAt: now,
        };
      });
      if (epics.length) await backlogRepository.insert(ctx, { epics });

      if (input.target) {
        const s = output.stories[0]!;
        const target = rows.stories.find(
          (r) => r.code === input.target!.code && r.status !== "APPROVED" && r.workspaceId === ws,
        );
        if (!target)
          throw new AppError("CONFLICT", "The story changed while it was being regenerated");
        await backlogRepository.resetStory(ctx, target.id, ["DRAFT", "REJECTED"], {
          epicId: epicIds.get(s.epicCode) ?? target.epicId,
          title: s.title,
          asA: s.asA,
          iWant: s.iWant,
          soThat: s.soThat,
          priority: s.priority,
          storyPoints: null,
          requirementCodes: s.requirementCodes,
          dependsOn: s.dependsOn,
          evidence: s.evidence,
          rationale: s.rationale,
          status: "DRAFT",
          origin: "ai",
          agentRunId: run.id,
          rejectionReason: null,
          prdVersion: input.prd.version,
          updatedAt: now,
        });
        return;
      }

      await backlogRepository.insert(ctx, {
        stories: output.stories.map((s) => ({
          id: newId(),
          workspaceId: ws,
          projectId,
          epicId: epicIds.get(s.epicCode)!,
          code: s.code,
          version: 1,
          basedOnVersion: null,
          title: s.title,
          asA: s.asA,
          iWant: s.iWant,
          soThat: s.soThat,
          priority: s.priority,
          storyPoints: null,
          requirementCodes: s.requirementCodes,
          dependsOn: s.dependsOn,
          evidence: s.evidence,
          rationale: s.rationale,
          rejectionReason: null,
          prdVersion: input.prd.version,
          status: "DRAFT",
          origin: "ai",
          agentRunId: run.id,
          createdBy: ctx.session.userId,
          createdAt: now,
          updatedAt: now,
          approvedBy: null,
          approvedAt: null,
        })),
      });
    },
  };
}
