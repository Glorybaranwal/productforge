import { withErrors } from "@/src/lib/http";
import { confirmRequirements } from "@/src/modules/requirements/discovery-service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/projects/:id/discovery/confirm — Gate 1. 409 with the blockers if questions are open. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(await confirmRequirements(ctx, (await params).id));
  },
);
