import { AppError } from "@/src/lib/errors";
import { withErrors } from "@/src/lib/http";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/agent-runs/:id — status, attempts, tokens, cost, latency and step events of an AI run. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const run = await agentRunRepository.findById(ctx, (await params).id);
    if (!run) throw new AppError("NOT_FOUND", "Run not found");
    return Response.json({ run });
  },
);
