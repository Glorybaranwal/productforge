import { withErrors } from "@/src/lib/http";
import { revokeApiKey } from "@/src/modules/api-keys/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** DELETE /api/workspace/api-keys/:id — revoke a key (yours, or any as owner/admin). Revoking twice is fine. */
export const DELETE = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json({ key: await revokeApiKey(ctx, (await params).id) });
  },
);
