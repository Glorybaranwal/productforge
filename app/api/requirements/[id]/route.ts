import { readJson, withErrors } from "@/src/lib/http";
import { updateRequirement } from "@/src/modules/requirements/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** PATCH /api/requirements/:id — edit a draft (`text`, `type`, `evidence`) or set `status` REJECTED/DRAFT. */
export const PATCH = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const requirement = await updateRequirement(ctx, (await params).id, await readJson(request));
    return Response.json({ requirement });
  },
);
