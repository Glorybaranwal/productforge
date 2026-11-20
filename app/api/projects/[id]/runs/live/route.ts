import { watchRuns } from "@/src/ai/orchestrator/watch-runs";
import { AppError } from "@/src/lib/errors";
import { withErrors } from "@/src/lib/http";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import { STAGES, type StageName } from "@/src/modules/agent-runs/schema";
import { getProject } from "@/src/modules/projects/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** Runs started up to this long before the page asked still count (the POST may land first). */
const GRACE_MS = 5_000;

/**
 * GET /api/projects/:id/runs/live?stages=discovery — Server-Sent Events: each step of the project's
 * runs of those stages, as it's logged (PF-027). The page opens it before starting a run and
 * closes it when the run's request returns.
 */
export const GET = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const projectId = (await params).id;
  await getProject(ctx, projectId);
  const stages = (new URL(request.url).searchParams.get("stages") ?? "").split(",");
  if (
    !stages.length ||
    !stages.every((s): s is StageName => (STAGES as readonly string[]).includes(s))
  )
    throw new AppError("VALIDATION_ERROR", `stages must be some of: ${STAGES.join(", ")}`);

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => (closed = true));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await watchRuns({
        since: Date.now() - GRACE_MS,
        isClosed: () => closed,
        load: () =>
          Promise.all(
            (stages as StageName[]).map((s) =>
              agentRunRepository.latestForProject(ctx, projectId, s),
            ),
          ),
        send: (progress) =>
          controller.enqueue(
            encoder.encode(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`),
          ),
      }).catch(() => undefined);
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
});
