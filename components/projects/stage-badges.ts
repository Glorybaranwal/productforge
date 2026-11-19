/** Pipeline card badges on the project page: one per module's status. */
import { formatDay } from "@/src/modules/sprints/schema";
import type { ExportStatus } from "@/src/modules/exports/service";
import type { ImpactStatus } from "@/src/modules/impact/service";
import type { PrdStatus } from "@/src/modules/prd/service";
import type { DiscoveryStatus } from "@/src/modules/requirements/discovery-service";
import type { SprintStatus } from "@/src/modules/sprints/service";
import type { BacklogStatus } from "@/src/modules/stories/service";
import type { TraceabilityStatus } from "@/src/modules/traceability/service";

export type StageBadge = { label: string; variant: "default" | "secondary" | "outline" };

export function prdBadge(status: PrdStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 1", variant: "outline" };
  if (status.state === "not_started") return { label: "Start", variant: "default" };
  if (status.state === "approved")
    return { label: `Approved v${status.version}`, variant: "default" };
  return { label: `Draft v${status.version}`, variant: "secondary" };
}

export function exportBadge(status: ExportStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 3", variant: "outline" };
  if (status.exports > 0) return { label: `Exported ${status.exports}×`, variant: "secondary" };
  return { label: "Ready", variant: "default" };
}

export function impactBadge(status: ImpactStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 1", variant: "outline" };
  if (status.state === "review")
    return { label: `${status.pending} to review`, variant: "secondary" };
  if (status.proposed) return { label: `${status.proposed} proposed`, variant: "secondary" };
  if (status.state === "clear")
    return {
      label: `${status.changes} ${status.changes === 1 ? "change" : "changes"} · reviewed`,
      variant: "default",
    };
  return { label: "No changes", variant: "outline" };
}

export function sprintBadge(status: SprintStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 3", variant: "outline" };
  if (status.state === "ready" || !status.end) return { label: "Plan", variant: "default" };
  if (status.warnings) return { label: `${status.warnings} to fix`, variant: "secondary" };
  return { label: `Done by ${formatDay(status.end)}`, variant: "default" };
}

export function traceabilityBadge(status: TraceabilityStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 1", variant: "outline" };
  return {
    label: `${status.score ?? 0}% traced`,
    variant: status.score === 100 ? "default" : "secondary",
  };
}

export function backlogBadge(status: BacklogStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "locked") return { label: "After Gate 2", variant: "outline" };
  if (status.state === "not_started") return { label: "Start", variant: "default" };
  if (status.state === "passed") return { label: "Gate 3 passed", variant: "default" };
  return { label: `${status.approved}/${status.stories} approved`, variant: "secondary" };
}

export function discoveryBadge(status: DiscoveryStatus): {
  label: string;
  variant: "default" | "secondary" | "outline";
} {
  if (status.state === "confirmed")
    return { label: `Confirmed · ${status.requirements}`, variant: "default" };
  if (status.state === "in_progress") {
    return {
      label: status.openQuestions ? `${status.openQuestions} open questions` : "Ready to confirm",
      variant: "secondary",
    };
  }
  return { label: "Start", variant: "default" };
}
