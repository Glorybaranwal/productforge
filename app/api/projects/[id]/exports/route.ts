import { withErrors } from "@/src/lib/http";
import { getExportOverview } from "@/src/modules/exports/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/exports — what would go to Jira (approved items only) and the export history. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await getExportOverview(ctx, (await params).id));
  },
);
