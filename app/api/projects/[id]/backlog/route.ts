import { withErrors } from "@/src/lib/http";
import { getBacklogState } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/backlog — epics, current stories with criteria and tasks, coverage, Gate 3. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await getBacklogState(ctx, (await params).id));
  },
);
