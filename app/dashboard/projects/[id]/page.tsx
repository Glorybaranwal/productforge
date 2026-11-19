import type { Metadata } from "next";

import { ProjectDetailView } from "@/components/projects/project-detail-view";
import { orNotFound } from "@/src/lib/not-found";
import { listAudit } from "@/src/modules/audit/service";
import { getExportStatus } from "@/src/modules/exports/service";
import { getImpactStatus } from "@/src/modules/impact/service";
import { getPrdStatus } from "@/src/modules/prd/service";
import { getProject } from "@/src/modules/projects/service";
import { getDiscoveryStatus } from "@/src/modules/requirements/discovery-service";
import { getSprintStatus } from "@/src/modules/sprints/service";
import { getBacklogStatus } from "@/src/modules/stories/service";
import { getTraceabilityStatus } from "@/src/modules/traceability/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

async function loadProject(id: string) {
  const ctx = await currentContext();
  return { ctx, project: await orNotFound(getProject(ctx, id)) };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { project } = await loadProject((await params).id);
  return { title: project.name };
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await currentContext();
  // One round of parallel reads: the sections share the cached project lookup, and the activity
  // feed is scoped by workspace (and RLS), so it needn't wait for it (ADR-023).
  const [project, activity, discovery, prd, backlog, traceability, exports, sprints, impact] =
    await orNotFound(
      Promise.all([
        getProject(ctx, id),
        listAudit(ctx, "project", id),
        getDiscoveryStatus(ctx, id),
        getPrdStatus(ctx, id),
        getBacklogStatus(ctx, id),
        getTraceabilityStatus(ctx, id),
        getExportStatus(ctx, id),
        getSprintStatus(ctx, id),
        getImpactStatus(ctx, id),
      ]),
    );
  return (
    <ProjectDetailView
      project={project}
      activity={activity}
      canDelete={ctx.role === "owner" || ctx.role === "admin"}
      discovery={discovery}
      prd={prd}
      backlog={backlog}
      traceability={traceability}
      exports={exports}
      sprints={sprints}
      impact={impact}
    />
  );
}
