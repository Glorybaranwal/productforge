import { withErrors } from "@/src/lib/http";
import { startNewVersion } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/prds/:id/new-version — copy an approved version into a new draft (version n+1). 201. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ prd: await startNewVersion(ctx, (await params).id) }, { status: 201 });
  },
);
