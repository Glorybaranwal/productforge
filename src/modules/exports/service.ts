import { AppError, parseOrThrow } from "@/src/lib/errors";
import { nowIso } from "@/src/lib/ids";
import { loadBacklog } from "@/src/modules/stories/state";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { toJiraCsv } from "./jira-csv";
import { toJiraJson } from "./jira-json";
import { buildJiraPlan } from "./plan";
import { listExports, recordExport } from "./record";
import { JiraExportOptions, type ExportRecord, type JiraPlan } from "./schema";

export type ExportOverview = {
  gate2Passed: boolean;
  /** Approved stories with their epics and tasks, as they'd go to Jira. */
  plan: JiraPlan;
  history: ExportRecord[];
};

export type ExportStatus = { state: "locked" | "ready"; stories: number; exports: number };

export async function getExportOverview(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ExportOverview> {
  const [b, history] = await Promise.all([
    loadBacklog(ctx, projectId),
    listExports(ctx, projectId),
  ]);
  return { gate2Passed: Boolean(b.prd), plan: buildJiraPlan(b, { includeTasks: true }), history };
}

export function summarizeExports(o: ExportOverview): ExportStatus {
  return {
    state: o.plan.counts.stories > 0 ? "ready" : "locked",
    stories: o.plan.counts.stories,
    exports: o.history.filter((h) => h.what.startsWith("Jira")).length,
  };
}

export async function getExportStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ExportStatus> {
  return summarizeExports(await getExportOverview(ctx, projectId));
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";

/** Jira CSV or JSON of the approved backlog (PF-050). Audit-logged. */
export async function exportJira(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<{ body: string; filename: string; contentType: string }> {
  const options = parseOrThrow(JiraExportOptions, input ?? {});
  const b = await loadBacklog(ctx, projectId);
  const plan = buildJiraPlan(b, options);
  if (plan.counts.stories === 0) {
    throw new AppError("CONFLICT", "Nothing to export yet — approve at least one story (Gate 3)");
  }
  await recordExport(ctx, projectId, "jira", {
    format: options.format,
    target: options.target,
    epics: plan.counts.epics,
    stories: plan.counts.stories,
    subtasks: plan.counts.subtasks,
  });
  const name = `${slugOf(b.project.name)}-jira-${options.target}`;
  if (options.format === "json") {
    const json = toJiraJson(plan, { projectName: b.project.name, generatedAt: nowIso(), options });
    return {
      body: `${JSON.stringify(json, null, 2)}\n`,
      filename: `${name}.json`,
      contentType: "application/json; charset=utf-8",
    };
  }
  return {
    body: toJiraCsv(plan, options),
    filename: `${name}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}
