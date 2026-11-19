import type { Metadata } from "next";

import { DiscoveryWorkspace } from "@/components/discovery/discovery-workspace";
import { MANAGER_ROLES } from "@/src/lib/auth";
import { orNotFound } from "@/src/lib/not-found";
import { getProject } from "@/src/modules/projects/service";
import { getDiscoveryState } from "@/src/modules/requirements/discovery-service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discovery" };

export default async function DiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await currentContext();
  const [project, state] = await orNotFound(
    Promise.all([getProject(ctx, id), getDiscoveryState(ctx, id)]),
  );
  return (
    <DiscoveryWorkspace
      project={project}
      state={state}
      canManage={MANAGER_ROLES.includes(ctx.role)}
    />
  );
}
