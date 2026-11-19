import { csvFile, csvRow } from "@/src/lib/csv";

import { descriptionText } from "./plan";
import type { JiraExportOptions, JiraItem, JiraPlan, JiraTarget } from "./schema";

const TYPE = (item: JiraItem, subtaskType: string) =>
  item.level === "epic" ? "Epic" : item.level === "story" ? "Story" : subtaskType;

/**
 * Jira-compatible CSV (PF-050). Parent rows come first. Labels use repeated columns, one per label,
 * as many as the item with the most labels. Estimates are in seconds, as the importer expects.
 *
 * - Jira Cloud: `Issue ID` + `Parent` link sub-tasks to stories and stories to epics.
 * - Jira Data Center: `Epic Name` + `Epic Link` link stories to epics; `Issue Id` + `Parent Id`
 *   link sub-tasks to stories.
 */
export function toJiraCsv(
  plan: JiraPlan,
  options: Pick<JiraExportOptions, "subtaskType"> & { target: JiraTarget },
): string {
  const labelColumns = Math.max(1, ...plan.items.map((i) => i.labels.length));
  const labels = (i: JiraItem) => Array.from({ length: labelColumns }, (_, n) => i.labels[n] ?? "");
  const common = (i: JiraItem) => [
    TYPE(i, options.subtaskType),
    i.summary,
    descriptionText(i.description),
    i.priority,
    i.storyPoints,
    i.estimateHours === null ? null : Math.round(i.estimateHours * 3600),
  ];
  const commonHeader = [
    "Issue Type",
    "Summary",
    "Description",
    "Priority",
    "Story Points",
    "Original Estimate",
  ];
  const labelHeader = Array.from({ length: labelColumns }, () => "Labels");

  if (options.target === "cloud") {
    return csvFile([
      csvRow(["Issue ID", "Parent", ...commonHeader, ...labelHeader]),
      ...plan.items.map((i) => csvRow([i.id, i.parentId, ...common(i), ...labels(i)])),
    ]);
  }
  return csvFile([
    csvRow(["Issue Id", "Parent Id", "Epic Name", "Epic Link", ...commonHeader, ...labelHeader]),
    ...plan.items.map((i) =>
      csvRow([
        i.id,
        i.level === "subtask" ? i.parentId : null,
        i.level === "epic" ? i.epicName : null,
        i.level === "story" ? i.epicName : null,
        ...common(i),
        ...labels(i),
      ]),
    ),
  ]);
}
