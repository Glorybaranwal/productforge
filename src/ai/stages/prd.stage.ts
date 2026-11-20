import type { Stage } from "@/src/ai/orchestrator/run-stage";
import type { PrdInput } from "@/src/ai/schemas/prd";
import { AppError } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { prdRepository } from "@/src/modules/prd/repository";
import { PrdContent, traceabilityProblems } from "@/src/modules/prd/schema";
import { getProject } from "@/src/modules/projects/service";
import { discoveryRepository } from "@/src/modules/requirements/discovery-repository";
import { questionRepository, requirementRepository } from "@/src/modules/requirements/repository";

import { block } from "./blocks";

export const prdRules: ((o: PrdContent, i: PrdInput) => string[])[] = [
  (output, input) =>
    traceabilityProblems(
      output,
      input.requirements.map((r) => r.code),
    ),
  (output, input) => {
    const rejected = new Set(input.rejected.map((t) => t.toLowerCase()));
    return output.inScope
      .filter((s) => rejected.has(s.toLowerCase()))
      .map((s) => `inScope: "${s}" was rejected at Gate 1`);
  },
];

export const prdStage: Stage<PrdInput, PrdContent> = {
  name: "prd",
  promptFile: "prd.v1.md",
  outputSchema: PrdContent,

  async loadContext({ ctx, projectId }) {
    const project = await getProject(ctx, projectId);
    const discovery = await discoveryRepository.get(ctx, projectId);
    if (discovery?.status !== "confirmed") {
      throw new AppError("CONFLICT", "Confirm the requirements (Gate 1) before generating the PRD");
    }
    const [requirements, questions] = await Promise.all([
      requirementRepository.listByProject(ctx, projectId),
      questionRepository.listByProject(ctx, projectId),
    ]);
    return {
      project: {
        name: project.name,
        domain: project.domain,
        audience: project.audience,
        teamSize: project.teamSize,
        sprintLengthDays: project.sprintLengthDays,
      },
      discovery: {
        summary: discovery.summary,
        actors: discovery.actors,
        goals: discovery.goals,
        constraints: discovery.constraints,
      },
      requirements: requirements
        .filter((r) => r.status === "APPROVED")
        .map((r) => ({
          code: r.code,
          text: r.text,
          type: r.type,
          evidence: r.evidence,
          rationale: r.rationale,
        })),
      rejected: requirements.filter((r) => r.status === "REJECTED").map((r) => r.text),
      clarifications: questions
        .filter((q) => q.state !== "open")
        .map((q) => ({
          question: q.question,
          state: q.state as "answered" | "assumption" | "skipped",
          answer: q.answer,
        })),
      conflicts: discovery.conflicts.map((c) => ({
        description: c.description,
        question: c.question,
      })),
    };
  },

  renderPrompt(input) {
    const reqs = input.requirements
      .map(
        (r) =>
          `${r.code} [${r.evidence}${r.type === "non_functional" ? ", non-functional" : ""}] ${r.text}`,
      )
      .join("\n");
    const clar = input.clarifications
      .map((c) => `- [${c.state}] ${c.question}${c.answer ? ` → ${c.answer}` : ""}`)
      .join("\n");
    return [
      `Project: ${input.project.name} · ${input.project.domain} · for ${input.project.audience}`,
      `Team: ${input.project.teamSize} people · ${input.project.sprintLengthDays}-day sprints`,
      "",
      block(
        "discovery",
        [
          `Summary: ${input.discovery.summary}`,
          `Actors: ${input.discovery.actors.join(", ") || "none listed"}`,
          `Goals: ${input.discovery.goals.join(" | ") || "none listed"}`,
          `Constraints: ${input.discovery.constraints.join(" | ") || "none listed"}`,
          `Unresolved conflicts: ${input.conflicts.map((c) => c.description).join(" | ") || "none"}`,
        ].join("\n"),
      ),
      "",
      block("requirements", reqs),
      "",
      block("clarifications", clar || "none"),
      "",
      `Rejected at Gate 1 (out-of-scope candidates): ${input.rejected.join(" | ") || "none"}`,
    ].join("\n");
  },

  businessRules: prdRules,

  /** Regenerating replaces the open draft; after approval it starts the next version. */
  async persist(output, _input, { ctx, projectId }, run) {
    const versions = await prdRepository.listByProject(ctx.workspace.id, projectId);
    const latest = versions.at(-1);
    const now = nowIso();
    if (latest?.status === "DRAFT") {
      await prdRepository.updateDraft(ctx.workspace.id, latest.id, {
        content: output,
        origin: "ai",
        agentRunId: run.id,
        updatedAt: now,
      });
      return;
    }
    await prdRepository.insertVersion({
      id: newId(),
      workspaceId: ctx.workspace.id,
      projectId,
      content: output,
      status: "DRAFT",
      origin: "ai",
      agentRunId: run.id,
      basedOnVersion: latest?.version ?? null,
      createdBy: ctx.session.userId,
      createdAt: now,
      updatedAt: now,
      approvedBy: null,
      approvedAt: null,
    });
  },
};
