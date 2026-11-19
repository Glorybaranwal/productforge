import { withErrors } from "@/src/lib/http";
import { getPrdState } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/prd — all PRD versions, approved requirements, Gate 2 blockers, last run. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await getPrdState(ctx, (await params).id));
  },
);
