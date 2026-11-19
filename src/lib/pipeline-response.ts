import type { AgentRun } from "@/src/modules/agent-runs/schema";

/** Shared body for pipeline endpoints: the runs in order, and the overall outcome. */
export function pipelineResponse({
  runs,
  replayed,
}: {
  runs: AgentRun[];
  replayed: boolean;
}): Response {
  const failed = runs.find((r) => r.status === "failed");
  return Response.json({
    agentRunId: runs.at(-1)?.id ?? null,
    runs: runs.map((r) => ({ id: r.id, stage: r.stage, status: r.status, error: r.error })),
    status: runs.length === 0 ? "nothing_to_do" : failed ? "failed" : "succeeded",
    error: failed?.error ?? null,
    replayed,
  });
}
