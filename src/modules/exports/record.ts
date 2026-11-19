import { listAudit, recordAudit } from "@/src/modules/audit/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { describeExport } from "./describe";
import type { ExportRecord } from "./schema";

/** Every export is audit-logged (PRD: "audit log for … exports"), as `<thing>.exported`. */
export async function recordExport(
  ctx: WorkspaceContext,
  projectId: string,
  thing: "jira" | "prd" | "backlog" | "traceability",
  details: Record<string, string | number | null>,
): Promise<void> {
  await recordAudit(ctx, {
    entityType: "project",
    entityId: projectId,
    action: `${thing}.exported`,
    diff: Object.fromEntries(Object.entries(details).map(([k, v]) => [k, { from: null, to: v }])),
  });
}

export async function listExports(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ExportRecord[]> {
  const entries = await listAudit(ctx, "project", projectId);
  return entries
    .filter((e) => e.action.endsWith(".exported"))
    .map((e) => ({ at: e.createdAt, actor: e.actorName, ...describeExport(e) }));
}
