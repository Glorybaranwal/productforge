import { withErrors } from "@/src/lib/http";
import { idempotencyKeyFrom } from "@/src/lib/idempotency";
import { getDiscoveryState, runDiscovery } from "@/src/modules/requirements/discovery-service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/discovery — sources, latest result, requirements, questions, Gate 1 blockers. */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json(await getDiscoveryState(ctx, (await params).id));
});

/**
 * POST /api/projects/:id/discovery — run (or re-run with answers) the discovery stage.
 * Accepts an `Idempotency-Key` header; returns `{ agentRunId, status, error, replayed }`.
 * A failed AI run is a result, not a request error: check `status`.
 */
export const POST = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const { run, replayed } = await runDiscovery(ctx, (await params).id, idempotencyKeyFrom(request));
  return Response.json({ agentRunId: run.id, status: run.status, error: run.error, replayed });
});
