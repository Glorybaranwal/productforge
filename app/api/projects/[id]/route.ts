import { readJson, withErrors } from "@/src/lib/http";
import { deleteProject, getProject, updateProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const { id } = await params;
  return Response.json({ project: await getProject(ctx, id) });
});

/** PATCH /api/projects/:id — partial update of project settings. */
export const PATCH = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const { id } = await params;
  const project = await updateProject(ctx, id, await readJson(request));
  return Response.json({ project });
});

/** DELETE /api/projects/:id — owner/admin only. 204 on success. */
export const DELETE = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const { id } = await params;
  await deleteProject(ctx, id);
  return new Response(null, { status: 204 });
});
