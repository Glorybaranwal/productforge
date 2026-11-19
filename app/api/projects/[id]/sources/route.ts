import { readJson, withErrors } from "@/src/lib/http";
import { addSource, listSources } from "@/src/modules/sources/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/sources */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({ sources: await listSources(ctx, (await params).id) });
});

/** POST /api/projects/:id/sources — `{ name, kind: "paste" | "file", text }`. 201 with `{ source }`. */
export const POST = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const source = await addSource(ctx, (await params).id, await readJson(request));
  return Response.json({ source }, { status: 201 });
});
