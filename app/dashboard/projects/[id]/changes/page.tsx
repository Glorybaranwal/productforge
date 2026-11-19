import type { Metadata } from "next";

import { ChangesView } from "@/components/impact/changes-view";
import { MANAGER_ROLES } from "@/src/lib/auth";
import { orNotFound } from "@/src/lib/not-found";
import { getChangesOverview } from "@/src/modules/impact/service";
import { getProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Change impact" };

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ requirement?: string }>;
}) {
  const { id } = await params;
  const { requirement } = await searchParams;
  const ctx = await currentContext();
  const [project, overview] = await orNotFound(
    Promise.all([getProject(ctx, id), getChangesOverview(ctx, id)]),
  );
  return (
    <ChangesView
      project={project}
      overview={overview}
      canManage={MANAGER_ROLES.includes(ctx.role)}
      initialRequirement={requirement}
    />
  );
}
