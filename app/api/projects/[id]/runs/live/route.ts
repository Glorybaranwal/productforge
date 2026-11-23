import { watchRuns } from "@/src/ai/orchestrator/watch-runs";
import { AppError } from "@/src/lib/errors";
import { withErrors } from "@/src/lib/http";
import { parseStages, runWatcher } from "@/src/modules/agent-runs/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** Open streams per user on this server (ADR-035); a page needs one at a time. */
export const MAX_STREAMS_PER_USER = 5;
const open = new Map<string, number>();

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
  const load = await runWatcher(
    ctx,
    projectId,
    parseStages(new URL(request.url).searchParams.get("stages")),
  );
  const user = ctx.session.userId;
  if ((open.get(user) ?? 0) >= MAX_STREAMS_PER_USER)
    throw new AppError("RATE_LIMITED", "Too many live views open. Close a tab and try again.", {
      // The cap clears the moment a tab closes, so a short wait is right.
      retryAfterSeconds: 5,
    });
  open.set(user, (open.get(user) ?? 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (open.get(user) ?? 1) - 1;
    if (left > 0) open.set(user, left);
    else open.delete(user);
  };

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
    release();
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await watchRuns({
        since: Date.now() - GRACE_MS,
        isClosed: () => closed,
        load,
        send: (progress) =>
          controller.enqueue(
            encoder.encode(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`),
          ),
      }).catch(() => undefined);
      release();
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
      release();
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
