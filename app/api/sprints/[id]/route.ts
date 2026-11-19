import { readJson, withErrors } from "@/src/lib/http";
import { updateSprint } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** PATCH /api/sprints/:id — `{ goal?, capacityPoints? }`. An empty goal goes back to the planner's. */
export const PATCH = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await updateSprint(ctx, (await params).id, await readJson(request)));
  },
);
