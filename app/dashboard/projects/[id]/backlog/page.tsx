import type { Metadata } from "next";

import { BacklogWorkspace } from "@/components/backlog/backlog-workspace";
import { MANAGER_ROLES } from "@/src/lib/auth";
import { orNotFound } from "@/src/lib/not-found";
import { getProject } from "@/src/modules/projects/service";
import { getBacklogState } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Backlog" };

export default async function BacklogPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string }>;
}) {
  const { id } = await params;
  const { story } = await searchParams;
  const ctx = await currentContext();
  const [project, state] = await orNotFound(
    Promise.all([getProject(ctx, id), getBacklogState(ctx, id)]),
  );
  return (
    <BacklogWorkspace
      project={project}
      state={state}
      canManage={MANAGER_ROLES.includes(ctx.role)}
      initialStory={story}
    />
  );
}
