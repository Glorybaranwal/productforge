import { withErrors } from "@/src/lib/http";
import { startStoryVersion } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/stories/:id/new-version — copy an approved story into a new draft (version n+1). 201. */
export const POST = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    return Response.json(
      { story: await startStoryVersion(ctx, (await params).id) },
      { status: 201 },
    );
  },
);
