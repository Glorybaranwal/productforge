import { readJson, withErrors } from "@/src/lib/http";
import { idempotencyKeyFrom } from "@/src/lib/idempotency";
import { changeResponse } from "@/src/modules/impact/response";
import { getChangesOverview, proposeChange } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/changes — change requests with their impact and review checklists. */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json(await getChangesOverview(ctx, (await params).id));
});

/**
 * POST /api/projects/:id/changes — propose `{ kind: "modify" | "add" | "withdraw", … , reason }`
 * after Gate 1 and run the impact analysis. Accepts `Idempotency-Key`. 201 with
 * `{ changeId, code, agentRunId, status, error, replayed }`.
 */
export const POST = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const out = await proposeChange(
    ctx,
    (await params).id,
    await readJson(request),
    idempotencyKeyFrom(request),
  );
  return changeResponse(out, out.replayed ? 200 : 201);
});
