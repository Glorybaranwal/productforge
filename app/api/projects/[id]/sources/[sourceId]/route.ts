import { withErrors } from "@/src/lib/http";
import { deleteSource } from "@/src/modules/sources/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** DELETE /api/projects/:id/sources/:sourceId — 204. Blocked after Gate 1 (sources are evidence). */
export const DELETE = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) => {
    const ctx = await currentContext();
    const { id, sourceId } = await params;
    await deleteSource(ctx, id, sourceId);
    return new Response(null, { status: 204 });
  },
);
