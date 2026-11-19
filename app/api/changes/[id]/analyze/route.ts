import { withErrors } from "@/src/lib/http";
import { changeResponse } from "@/src/modules/impact/response";
import { reanalyzeChange } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/changes/:id/analyze — run the impact analysis again (proposals only). */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return changeResponse(await reanalyzeChange(ctx, (await params).id));
  },
);
