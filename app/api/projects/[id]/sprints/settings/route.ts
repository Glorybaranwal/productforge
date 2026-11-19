import { readJson, withErrors } from "@/src/lib/http";
import { saveSprintSettings } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** PUT /api/projects/:id/sprints/settings — `{ velocity, startDate }`. Returns the board. */
export const PUT = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await saveSprintSettings(ctx, (await params).id, await readJson(request)));
  },
);
