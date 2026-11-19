import { readJson, withErrors } from "@/src/lib/http";
import { getStory, updateStorySection } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/stories/:id — one story version. */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({ story: await getStory(ctx, (await params).id) });
});

/**
 * PATCH /api/stories/:id — `{ section: "story" | "criteria" | "tasks", value }` replaces one editor
 * section of a draft story. 409 if approved or rejected.
 */
export const PATCH = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({
    story: await updateStorySection(ctx, (await params).id, await readJson(request)),
  });
});
