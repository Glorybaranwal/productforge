import type { Metadata } from "next";

import { TraceabilityView } from "@/components/traceability/traceability-view";
import { orNotFound } from "@/src/lib/not-found";
import { getProject } from "@/src/modules/projects/service";
import { getTraceability } from "@/src/modules/traceability/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Traceability" };

export default async function TraceabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await currentContext();
  const [project, trace] = await orNotFound(
    Promise.all([getProject(ctx, id), getTraceability(ctx, id)]),
  );
  return <TraceabilityView project={project} trace={trace} />;
}
