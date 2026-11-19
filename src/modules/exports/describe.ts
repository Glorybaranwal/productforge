import type { AuditLog } from "@/src/modules/audit/schema";

import { JIRA_TARGET_LABELS, type JiraTarget } from "./schema";

const to = (entry: AuditLog, key: string) =>
  (entry.diff?.[key] as { to?: unknown } | undefined)?.to;

/** Plain-language summary of one export, for the history list and the activity feed. */
export function describeExport(entry: AuditLog): { what: string; detail: string } {
  switch (entry.action) {
    case "jira.exported":
      return {
        what: `Jira ${String(to(entry, "format") ?? "csv").toUpperCase()} (${JIRA_TARGET_LABELS[to(entry, "target") as JiraTarget] ?? "Jira"})`,
        detail: `${String(to(entry, "stories") ?? 0)} stories, ${String(to(entry, "subtasks") ?? 0)} sub-tasks`,
      };
    case "prd.exported":
      return { what: "PRD Markdown", detail: `version ${String(to(entry, "version") ?? "")}` };
    case "backlog.exported":
      return {
        what: "Backlog Markdown",
        detail: `${String(to(entry, "stories") ?? 0)} approved stories`,
      };
    case "traceability.exported":
      return { what: "Traceability CSV", detail: `${String(to(entry, "rows") ?? 0)} requirements` };
    default:
      return { what: entry.action, detail: "" };
  }
}
