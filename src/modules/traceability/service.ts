import { recordExport } from "@/src/modules/exports/record";
import { loadBacklog } from "@/src/modules/stories/state";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { traceabilityToCsv } from "./csv";
import { buildTraceability } from "./matrix";
import type { Traceability } from "./schema";

export type TraceabilityStatus = { state: "locked" | "ready"; score: number | null; gaps: number };

export async function getTraceability(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<Traceability> {
  const base = `/dashboard/projects/${projectId}`;
  return buildTraceability(await loadBacklog(ctx, projectId), {
    backlog: `${base}/backlog`,
    prd: `${base}/prd`,
    changes: `${base}/changes`,
  });
}

export function summarizeTraceability(t: Traceability): TraceabilityStatus {
  return {
    state: t.gate1Passed ? "ready" : "locked",
    score: t.score,
    gaps: t.gaps.filter((g) => g.severity === "blocker").length,
  };
}

export async function getTraceabilityStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<TraceabilityStatus> {
  return summarizeTraceability(await getTraceability(ctx, projectId));
}

/** The requirement matrix as CSV. Exports are audit-logged (PRD: "audit log for … exports"). */
export async function exportTraceabilityCsv(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<{ csv: string; filename: string }> {
  const [trace, { project }] = await Promise.all([
    getTraceability(ctx, projectId),
    loadBacklog(ctx, projectId),
  ]);
  await recordExport(ctx, projectId, "traceability", {
    format: "csv",
    rows: trace.requirements.length,
    score: trace.score,
  });
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return { csv: traceabilityToCsv(trace), filename: `${slug}-traceability.csv` };
}
