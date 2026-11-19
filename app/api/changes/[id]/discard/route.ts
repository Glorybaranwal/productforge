import { withErrors } from "@/src/lib/http";
import { changeResponse } from "@/src/modules/impact/response";
import { discardChange } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/changes/:id/discard — drop a proposal; nothing changes. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return changeResponse(await discardChange(ctx, (await params).id));
  },
);
