import { withErrors } from "@/src/lib/http";
import { getTraceability } from "@/src/modules/traceability/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * GET /api/projects/:id/traceability — requirement → PRD → stories → criteria → tasks matrix,
 * the traceability score and the gap list (PF-043).
 */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await getTraceability(ctx, (await params).id));
  },
);
