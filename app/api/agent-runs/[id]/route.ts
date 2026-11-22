import { withErrors } from "@/src/lib/http";
import { getRun } from "@/src/modules/agent-runs/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/agent-runs/:id — status, attempts, tokens, cost, latency and step events of an AI run. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const run = await getRun(ctx, (await params).id);
    return Response.json({ run });
  },
);
