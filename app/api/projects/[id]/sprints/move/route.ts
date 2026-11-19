import { readJson, withErrors } from "@/src/lib/http";
import { moveStoryToSprint } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/projects/:id/sprints/move — `{ storyCode, sprintNumber | null }`. Places a story by hand
 * (null takes it out of the plan); the next sprint after the last can be created this way.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await moveStoryToSprint(ctx, (await params).id, await readJson(request)));
  },
);
