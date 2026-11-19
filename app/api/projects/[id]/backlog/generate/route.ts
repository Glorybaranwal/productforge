import { withErrors } from "@/src/lib/http";
import { idempotencyKeyFrom } from "@/src/lib/idempotency";
import { pipelineResponse } from "@/src/lib/pipeline-response";
import { generateBacklog } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/projects/:id/backlog/generate — fill the backlog's gaps: stories for uncovered
 * requirements, then criteria and tasks for drafts without them. Accepts `Idempotency-Key`.
 * Returns `{ agentRunId, runs, status, error, replayed }`; 409 before Gate 2.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const out = await generateBacklog(ctx, (await params).id, idempotencyKeyFrom(request));
    return pipelineResponse(out);
  },
);
