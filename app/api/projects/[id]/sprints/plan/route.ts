import { readJson, withErrors } from "@/src/lib/http";
import { planProjectSprints } from "@/src/modules/sprints/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/projects/:id/sprints/plan — `{ keepPinned? }`. Plans approved stories into sprints:
 * dependencies first, never over capacity, Must → Should → Could. 409 if nothing is approved.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await planProjectSprints(ctx, (await params).id, await readJson(request)));
  },
);
