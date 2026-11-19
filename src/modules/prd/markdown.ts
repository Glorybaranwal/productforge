import { sectionLines } from "./diff";
import { PRD_SECTIONS, type Prd } from "./schema";

/** The PRD as Markdown, for sharing in docs, wikis or tickets. */
export function prdToMarkdown(projectName: string, prd: Prd): string {
  const status =
    prd.status === "APPROVED" && prd.approvedAt
      ? `Approved · version ${prd.version} · ${prd.approvedAt.slice(0, 10)}`
      : `Draft · version ${prd.version}`;
  const lines = [`# PRD — ${projectName}`, "", `_${status}_`, ""];
  for (const { key, title } of PRD_SECTIONS) {
    const items = sectionLines(prd.content, key);
    lines.push(`## ${title}`, "");
    if (items.length === 0) lines.push("_None._");
    else if (key === "summary" || key === "problem")
      lines.push(...items.flatMap((p) => [p, ""]).slice(0, -1));
    else lines.push(...items.map((item) => `- ${item}`));
    lines.push("");
  }
  return lines.join("\n");
}
