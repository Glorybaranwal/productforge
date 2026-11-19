import { readJson, withErrors } from "@/src/lib/http";
import { idempotencyKeyFrom } from "@/src/lib/idempotency";
import { pipelineResponse } from "@/src/lib/pipeline-response";
import { regenerateStory } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/stories/:id/regenerate — `{ note }`: rewrite a draft or rejected story with the
 * reviewer's note, then its criteria and tasks. Accepts `Idempotency-Key`.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const out = await regenerateStory(
      ctx,
      (await params).id,
      await readJson(request),
      idempotencyKeyFrom(request),
    );
    return pipelineResponse(out);
  },
);
