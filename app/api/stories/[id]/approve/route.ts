import { withErrors } from "@/src/lib/http";
import { approveStory } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/stories/:id/approve — Gate 3 for one story: approve and freeze it with its criteria and tasks. 409 with blockers. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ story: await approveStory(ctx, (await params).id) });
  },
);
