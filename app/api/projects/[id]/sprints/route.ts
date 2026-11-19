import { withErrors } from "@/src/lib/http";
import { getSprintBoard } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/sprints — sprints, their stories, unplanned stories (with reasons) and warnings. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await getSprintBoard(ctx, (await params).id));
  },
);
