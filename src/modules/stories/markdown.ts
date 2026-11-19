import { CRITERION_KIND_LABELS, PRIORITY_LABELS, storySentence } from "./schema";
import type { BacklogState } from "./state";

/** Approved stories as Markdown, grouped by epic. Drafts and rejected stories are never exported. */
export function backlogToMarkdown(projectName: string, state: BacklogState): string {
  const approved = state.stories.filter((s) => s.status === "APPROVED");
  const lines = [
    `# Backlog — ${projectName}`,
    "",
    `_Approved stories only · ${approved.length} ${approved.length === 1 ? "story" : "stories"} · ${state.counts.points} points · from PRD v${state.prdVersion ?? "–"}_`,
  ];
  if (approved.length === 0) return [...lines, "", "_No approved stories yet._", ""].join("\n");
  for (const epic of state.epics) {
    const stories = approved.filter((s) => s.epicId === epic.id);
    if (!stories.length) continue;
    lines.push("", `## ${epic.code} · ${epic.title}`);
    for (const s of stories) {
      lines.push(
        "",
        `### ${s.code} · ${s.title}`,
        "",
        `${storySentence(s)}`,
        "",
        `- **Priority:** ${PRIORITY_LABELS[s.priority]} · **Points:** ${s.storyPoints ?? "–"} · **Version:** ${s.version}`,
        `- **Requirements:** ${s.requirementCodes.join(", ")}`,
        ...(s.dependsOn.length ? [`- **Depends on:** ${s.dependsOn.join(", ")}`] : []),
        "",
        "**Acceptance criteria**",
        "",
        ...s.criteria.map(
          (c) =>
            `- _${CRITERION_KIND_LABELS[c.kind]}_ — **Given** ${c.given}, **when** ${c.when}, **then** ${c.then}.`,
        ),
        "",
        "**Tasks**",
        "",
        ...s.tasks.map(
          (t) =>
            `- ${t.code} · ${t.title} (${t.estimateHours} h)${t.description ? ` — ${t.description}` : ""}`,
        ),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
