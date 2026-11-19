import { readJson, withErrors } from "@/src/lib/http";
import { rejectStory } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/stories/:id/reject — `{ reason }`; the reason guides the next draft. */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({
      story: await rejectStory(ctx, (await params).id, await readJson(request)),
    });
  },
);
