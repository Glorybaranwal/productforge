import type { Stage } from "@/src/ai/orchestrator/run-stage";
import type { ImpactInput } from "@/src/ai/schemas/impact";
import { candidateRefs, type Candidates } from "@/src/modules/impact/candidates";
import { impactRepository } from "@/src/modules/impact/repository";
import { ImpactOutput, type RequirementSnapshot } from "@/src/modules/impact/schema";

import { block } from "./blocks";

export const impactRules: ((o: ImpactOutput, i: ImpactInput) => string[])[] = [
  (output, input) => {
    const refs = candidateRefs(input.candidates);
    return output.items.flatMap((item) => {
      const kind = refs.get(item.ref);
      if (!kind)
        return [`items: "${item.ref}" isn't one of the listed items — use only the refs given`];
      return kind === item.kind ? [] : [`items: ${item.ref} is a ${kind}, not a ${item.kind}`];
    });
  },
  (output, input) => {
    const given = new Set(output.items.map((i) => i.ref));
    const needed = [
      ...(input.candidates.prd ? ["PRD"] : []),
      ...input.candidates.stories.map((s) => s.code),
    ];
    return needed
      .filter((ref) => !given.has(ref))
      .map((ref) => `items: explain the impact on ${ref}`);
  },
  (output) => {
    const seen = new Set<string>();
    return output.items.flatMap((i) => {
      if (seen.has(i.ref)) return [`items: ${i.ref} appears more than once`];
      seen.add(i.ref);
      return [];
    });
  },
];

const snapshot = (label: string, s: RequirementSnapshot | null) =>
  s
    ? `${label}: [${s.evidence}${s.type === "non_functional" ? ", non-functional" : ""}] ${s.text}`
    : `${label}: —`;

export function renderItems(c: Candidates): string {
  const lines: string[] = [];
  if (c.prd) {
    lines.push(`PRD (approved version ${c.prd.version})`);
    for (const l of c.prd.lines) lines.push(`  cites it: ${l}`);
    if (!c.prd.lines.length) lines.push("  doesn't mention this requirement yet");
  }
  for (const s of c.stories) {
    const where = s.sprint ? `, planned in sprint ${s.sprint}` : "";
    const others = s.otherRequirements.length
      ? `; also links ${s.otherRequirements.join(", ")}`
      : "";
    lines.push(
      `${s.code} [${s.status.toLowerCase()} v${s.version}${where}${others}] ${s.title} — ${s.sentence}`,
    );
    for (const ac of s.criteria)
      lines.push(`  ${ac.ref} (${ac.kind}) Given ${ac.given}; when ${ac.when}; then ${ac.then}`);
    for (const t of s.tasks) lines.push(`  ${t.ref} ${t.title}`);
  }
  return lines.join("\n") || "none — nothing links this requirement yet";
}

/** Explains one proposed change; saves the analysis on the change (it stays a proposal). */
export function impactStage(
  changeId: string,
  input: ImpactInput,
): Stage<ImpactInput, ImpactOutput> {
  return {
    name: "impact",
    promptFile: "impact.v1.md",
    outputSchema: ImpactOutput,
    async loadContext() {
      return input;
    },
    renderPrompt(i) {
      return [
        `Project: ${i.project.name} · ${i.project.domain}`,
        "",
        block(
          "change",
          [
            `Kind: ${i.change.kind} ${i.change.code ?? "(new requirement, code assigned on approval)"}`,
            snapshot("Before", i.change.before),
            snapshot("After", i.change.after),
            `Reason: ${i.change.reason}`,
          ].join("\n"),
        ),
        "",
        block("items", renderItems(i.candidates)),
      ].join("\n");
    },
    businessRules: impactRules,
    async persist(output, _i, { ctx }, run) {
      await impactRepository.update(ctx.workspace.id, changeId, {
        impact: output,
        agentRunId: run.id,
      });
    },
  };
}
