import { withErrors } from "@/src/lib/http";
import { approvePrd } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/prds/:id/approve — Gate 2. 409 with the blockers if traceability or content is incomplete. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ prd: await approvePrd(ctx, (await params).id) });
  },
);
