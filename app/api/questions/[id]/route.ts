import { readJson, withErrors } from "@/src/lib/http";
import { resolveQuestion } from "@/src/modules/requirements/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * PATCH /api/questions/:id — `{ state: "answered", answer }`, `{ state: "assumption", answer }`,
 * `{ state: "skipped" }` or `{ state: "open" }`.
 */
export const PATCH = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const question = await resolveQuestion(ctx, (await params).id, await readJson(request));
    return Response.json({ question });
  },
);
