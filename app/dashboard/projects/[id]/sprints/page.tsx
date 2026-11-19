import type { Metadata } from "next";

import { SprintView } from "@/components/sprints/sprint-view";
import { orNotFound } from "@/src/lib/not-found";
import { getProject } from "@/src/modules/projects/service";
import { getSprintBoard } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sprint plan" };

export default async function SprintsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await currentContext();
  const [project, board] = await orNotFound(
    Promise.all([getProject(ctx, id), getSprintBoard(ctx, id)]),
  );
  return <SprintView project={project} initial={board} />;
}
