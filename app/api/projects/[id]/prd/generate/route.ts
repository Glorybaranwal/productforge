import { withErrors } from "@/src/lib/http";
import { idempotencyKeyFrom } from "@/src/lib/idempotency";
import { generatePrd } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/projects/:id/prd/generate — generate the PRD from the Gate 1 requirements.
 * Accepts `Idempotency-Key`; returns `{ agentRunId, status, error, replayed }`. 409 before Gate 1.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { run, replayed } = await generatePrd(
      ctx,
      (await params).id,
      idempotencyKeyFrom(request),
    );
    return Response.json({ agentRunId: run.id, status: run.status, error: run.error, replayed });
  },
);
