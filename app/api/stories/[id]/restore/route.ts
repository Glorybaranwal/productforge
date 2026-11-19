import { withErrors } from "@/src/lib/http";
import { restoreStory } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/stories/:id/restore — move a rejected story back to draft. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ story: await restoreStory(ctx, (await params).id) });
  },
);
