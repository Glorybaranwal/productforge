import type { Metadata } from "next";

import { PrdWorkspace } from "@/components/prd/prd-workspace";
import { MANAGER_ROLES } from "@/src/lib/auth";
import { orNotFound } from "@/src/lib/not-found";
import { getPrdState } from "@/src/modules/prd/service";
import { getProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PRD" };

export default async function PrdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await currentContext();
  const [project, state] = await orNotFound(
    Promise.all([getProject(ctx, id), getPrdState(ctx, id)]),
  );
  return (
    <PrdWorkspace project={project} state={state} canManage={MANAGER_ROLES.includes(ctx.role)} />
  );
}
