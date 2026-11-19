import { readJson, withErrors } from "@/src/lib/http";
import { addStory } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/projects/:id/stories — add a story by hand (draft, origin human). 201. */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const story = await addStory(ctx, (await params).id, await readJson(request));
    return Response.json({ story }, { status: 201 });
  },
);
