import { readJson, withErrors } from "@/src/lib/http";
import { addRequirement } from "@/src/modules/requirements/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** POST /api/projects/:id/requirements — add a requirement by hand: `{ text, type }`. 201. */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const requirement = await addRequirement(ctx, (await params).id, await readJson(request));
    return Response.json({ requirement }, { status: 201 });
  },
);
