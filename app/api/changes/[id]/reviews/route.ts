import { readJson, withErrors } from "@/src/lib/http";
import { changeResponse } from "@/src/modules/impact/response";
import { markReviewed } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/changes/:id/reviews — `{ ref: "PRD" | "US-003", note? }`: reviewed, no change needed. */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return changeResponse(await markReviewed(ctx, (await params).id, await readJson(request)));
  },
);
