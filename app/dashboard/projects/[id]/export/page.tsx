import type { Metadata } from "next";

import { ExportView } from "@/components/exports/export-view";
import { orNotFound } from "@/src/lib/not-found";
import { getExportOverview } from "@/src/modules/exports/service";
import { getProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Export to Jira" };

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await currentContext();
  const [project, overview] = await orNotFound(
    Promise.all([getProject(ctx, id), getExportOverview(ctx, id)]),
  );
  return <ExportView project={project} overview={overview} />;
}
