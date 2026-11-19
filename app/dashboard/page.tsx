import type { Metadata } from "next";

import { ProjectsView } from "@/components/projects/projects-view";
import { listProjects } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Projects" };

export default async function DashboardPage() {
  const ctx = await currentContext();
  return <ProjectsView projects={await listProjects(ctx)} />;
}
