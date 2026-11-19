import { withErrors } from "@/src/lib/http";
import { changeResponse } from "@/src/modules/impact/response";
import { approveChange } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/changes/:id/approve — put the change in force: the requirement's next version; affected items need review. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return changeResponse(await approveChange(ctx, (await params).id));
  },
);
