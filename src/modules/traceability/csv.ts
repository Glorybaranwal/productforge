import { csvFile, csvRow as row } from "@/src/lib/csv";
import { EVIDENCE_LABELS } from "@/src/modules/requirements/schema";

import { TRACE_STATUS_LABELS, type Traceability } from "./schema";

/** The requirement matrix as CSV, one row per requirement (for auditors and spreadsheets). */
export function traceabilityToCsv(t: Traceability): string {
  const header = [
    "Requirement",
    "Type",
    "Evidence",
    "Text",
    "PRD sections",
    "Stories",
    "Story status",
    "Criteria (positive/negative/edge)",
    "Tasks",
    "Hours",
    "Trace status",
    "Trace score %",
  ];
  const lines = t.requirements.map((r) => {
    const all = [...r.stories, ...r.rejected];
    const sum = (k: "positive" | "negative" | "edge") =>
      r.stories.reduce((n, s) => n + s.criteria[k], 0);
    return row([
      r.code,
      r.type === "functional" ? "Functional" : "Non-functional",
      EVIDENCE_LABELS[r.evidence],
      r.text,
      r.prdSections.join("; "),
      all.map((s) => `${s.code} v${s.version}`).join("; "),
      all.map((s) => s.status.toLowerCase()).join("; "),
      r.stories.length ? `${sum("positive")}/${sum("negative")}/${sum("edge")}` : "",
      r.stories.reduce((n, s) => n + s.tasks, 0) || "",
      r.stories.reduce((n, s) => n + s.hours, 0) || "",
      TRACE_STATUS_LABELS[r.status],
      r.score === null ? "" : Math.round(r.score * 100),
    ]);
  });
  return csvFile([row(header), ...lines]);
}

export { csvCell } from "@/src/lib/csv";
