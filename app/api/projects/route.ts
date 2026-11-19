import { readJson, withErrors } from "@/src/lib/http";
import { createProject, listProjects } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects — projects in the caller's workspace, most recently updated first. */
export const GET = withErrors(async () => {
  const ctx = await currentContext();
  return Response.json({ projects: await listProjects(ctx) });
});

/** POST /api/projects — create a project. 201 with `{ project }`, 400 with field errors. */
export const POST = withErrors(async (request: Request) => {
  const ctx = await currentContext();
  const project = await createProject(ctx, await readJson(request));
  return Response.json({ project }, { status: 201 });
});
