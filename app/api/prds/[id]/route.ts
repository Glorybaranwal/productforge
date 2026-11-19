import { readJson, withErrors } from "@/src/lib/http";
import { getPrd, updatePrdSection } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/prds/:id — one PRD version. */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({ prd: await getPrd(ctx, (await params).id) });
});

/** PATCH /api/prds/:id — `{ section, value }` replaces one section of a draft. 409 if approved. */
export const PATCH = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({
    prd: await updatePrdSection(ctx, (await params).id, await readJson(request)),
  });
});
