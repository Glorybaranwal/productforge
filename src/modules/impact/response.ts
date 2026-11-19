import type { AnalysisResult } from "./access";

/** Body for change-request actions: the change, and the analysis run behind it. */
export function changeResponse(r: AnalysisResult, status = 200): Response {
  return Response.json(
    {
      changeId: r.changeId,
      code: r.code,
      agentRunId: r.run?.id ?? null,
      status: r.run?.status ?? null,
      error: r.run?.status === "failed" ? r.run.error : null,
      replayed: r.replayed,
    },
    { status },
  );
}
