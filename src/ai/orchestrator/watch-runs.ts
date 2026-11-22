import type { AgentRun } from "@/src/modules/agent-runs/schema";

/** One step of a run as the page shows it (PF-027). */
export type RunProgress = {
  runId: string;
  stage: AgentRun["stage"];
  step: AgentRun["events"][number]["step"];
  message: string;
  at: string;
};

export type WatchOptions = {
  /** The newest run of each watched stage. */
  load: () => Promise<(AgentRun | null)[]>;
  send: (progress: RunProgress) => void;
  /** Runs started before this instant are history, not progress. */
  since: number;
  isClosed: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
};

/**
 * Polls the run log and sends each new step of the runs started since `since`, until the client
 * goes away or the timeout passes. Polling the database (not an in-memory emitter) works when the
 * request that runs the stage and the one that watches it land on different servers.
 */
export async function watchRuns({
  load,
  send,
  since,
  isClosed,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  intervalMs = 500,
  timeoutMs = 5 * 60_000,
}: WatchOptions): Promise<void> {
  const sent = new Map<string, number>();
  const stopAt = Date.now() + timeoutMs;
  while (!isClosed() && Date.now() < stopAt) {
    for (const run of await load()) {
      if (!run || Date.parse(run.createdAt) < since) continue;
      const already = sent.get(run.id) ?? 0;
      for (const event of run.events.slice(already))
        send({
          runId: run.id,
          stage: run.stage,
          step: event.step,
          message: event.message,
          at: event.at,
        });
      sent.set(run.id, run.events.length);
    }
    await sleep(intervalMs);
  }
}
