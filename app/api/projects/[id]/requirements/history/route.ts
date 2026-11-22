import { withErrors } from "@/src/lib/http";
import { getRequirementHistory } from "@/src/modules/requirements/history";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/requirements/history — versions of every requirement that has more than one. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ history: await getRequirementHistory(ctx, (await params).id) });
  },
);
