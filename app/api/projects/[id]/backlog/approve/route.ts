import { withErrors } from "@/src/lib/http";
import { approveReadyStories } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/projects/:id/backlog/approve — approve every draft story with no blockers. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await approveReadyStories(ctx, (await params).id));
  },
);
