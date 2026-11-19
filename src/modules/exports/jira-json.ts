import { descriptionText } from "./plan";
import type { DescriptionBlock, JiraExportOptions, JiraItem, JiraPlan } from "./schema";

type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: AdfNode[];
};

const text = (t: string): AdfNode => ({ type: "text", text: t });
const paragraph = (t: string): AdfNode => ({ type: "paragraph", content: t ? [text(t)] : [] });

/** Atlassian Document Format — what Jira Cloud's REST API v3 expects in `description`. */
export function toAdf(blocks: DescriptionBlock[]): AdfNode {
  return {
    type: "doc",
    content: blocks.map((b): AdfNode => {
      if (b.kind === "p") return paragraph(b.text);
      if (b.kind === "h") return { type: "heading", attrs: { level: 3 }, content: [text(b.text)] };
      return {
        type: b.kind === "ol" ? "orderedList" : "bulletList",
        content: b.items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
      };
    }),
  };
}

/** 1.5 → "1h 30m" (Jira's duration format). */
export function jiraDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

function fields(item: JiraItem, subtaskType: string) {
  return {
    issuetype: {
      name: item.level === "epic" ? "Epic" : item.level === "story" ? "Story" : subtaskType,
    },
    summary: item.summary,
    description: { ...toAdf(item.description), version: 1 },
    labels: item.labels,
    ...(item.priority ? { priority: { name: item.priority } } : {}),
    ...(item.estimateHours !== null
      ? { timetracking: { originalEstimate: jiraDuration(item.estimateHours) } }
      : {}),
  };
}

/**
 * The same items as nested JSON in Jira REST API v3 shapes (`fields` for POST /rest/api/3/issue),
 * for scripts and integrations. Project, parent keys and the story-points field id differ per
 * site, so they're left to the importer; `notes` says how.
 */
export function toJiraJson(
  plan: JiraPlan,
  meta: { projectName: string; generatedAt: string; options: JiraExportOptions },
) {
  const children = (parentId: number) => plan.items.filter((i) => i.parentId === parentId);
  const node = (item: JiraItem): Record<string, unknown> => ({
    ref: item.ref,
    fields: fields(item, meta.options.subtaskType),
    ...(item.storyPoints !== null ? { storyPoints: item.storyPoints } : {}),
    descriptionText: descriptionText(item.description),
    ...(item.level === "epic" ? { stories: children(item.id).map(node) } : {}),
    ...(item.level === "story" ? { subtasks: children(item.id).map(node) } : {}),
  });
  return {
    format: "productforge.jira-export/v1",
    generatedAt: meta.generatedAt,
    project: meta.projectName,
    prdVersion: plan.prdVersion,
    options: meta.options,
    counts: plan.counts,
    notes: [
      "Approved stories only. Each `fields` object is a Jira REST API v3 issue payload without `project` and `parent`.",
      "Create epics first; then create each story with fields.parent = { key: <epic key> }; then each sub-task with fields.parent = { key: <story key> }.",
      "Add fields.project = { key: <your project key> } to every payload.",
      "Story points: copy `storyPoints` into your site's story-points field (its id differs per site, e.g. customfield_10016).",
    ],
    warnings: plan.warnings,
    epics: plan.items.filter((i) => i.level === "epic").map(node),
  };
}
