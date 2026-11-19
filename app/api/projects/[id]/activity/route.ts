import { withErrors } from "@/src/lib/http";
import { listAudit } from "@/src/modules/audit/service";
import { getProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/activity — the project's audit trail, newest first. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { id } = await params;
    await getProject(ctx, id); // 404 if the project isn't in this workspace
    return Response.json({ activity: await listAudit(ctx, "project", id) });
  },
);
