import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { budgetError, budgetLimits, usageWindow } from "@/src/ai/orchestrator/budget";
import * as generatePrdRoute from "@/app/api/projects/[id]/prd/generate/route";
import { errorResponse } from "@/src/lib/errors";
import { setLLMClient } from "@/src/ai/llm-client";
import { resetDb } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";

const limits = { runsPerMinute: 3, monthlyTokens: 1000 };

describe("AI budget (ADR-035)", () => {
  it("allows runs under both limits", () => {
    expect(budgetError({ userRuns: 2, workspaceTokens: 999 }, limits)).toBeNull();
  });

  it("refuses the run that would pass the per-minute limit", () => {
    const err = budgetError({ userRuns: 3, workspaceTokens: 0 }, limits);
    expect(err?.code).toBe("RATE_LIMITED");
    expect(err?.status).toBe(429);
    expect(err?.details).toEqual({ retryAfterSeconds: 60 });
  });

  it("refuses once the workspace used its monthly tokens", () => {
    const err = budgetError({ userRuns: 0, workspaceTokens: 1000 }, limits);
    expect(err?.message).toContain("budget for the month");
  });

  it("tells a client over the monthly budget to wait until the 1st (UTC)", () => {
    const at = (iso: string) =>
      budgetError({ userRuns: 0, workspaceTokens: 1000 }, limits, new Date(iso));
    const retry = (iso: string) =>
      (at(iso)?.details as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(retry("2026-11-20T10:00:00.000Z")).toBe(
      (Date.UTC(2026, 11, 1) - Date.parse("2026-11-20T10:00:00.000Z")) / 1000,
    );
    // The last millisecond of the month: one second (rounded up), never 0.
    expect(retry("2026-11-30T23:59:59.999Z")).toBe(1);
    // Across the year: 31 Dec rolls to 1 Jan.
    expect(retry("2026-12-31T23:00:00.000Z")).toBe(3600);
    expect(retry("2026-12-31T23:59:59.999Z")).toBe(1);
    // The first instant of a month: the whole month ahead.
    expect(retry("2026-11-01T00:00:00.000Z")).toBe(30 * 86_400);
    expect(errorResponse(at("2026-12-31T23:00:00.000Z")!).headers.get("Retry-After")).toBe("3600");
  });

  it("reads limits from the env, ignoring junk", () => {
    expect(
      budgetLimits({
        AI_RUNS_PER_USER_PER_MINUTE: "5",
        AI_MONTHLY_TOKEN_BUDGET_PER_WORKSPACE: "x",
      }),
    ).toEqual({
      runsPerMinute: 5,
      monthlyTokens: 2_000_000,
    });
  });

  it("counts the last minute for the user and the UTC month for the workspace", () => {
    const w = usageWindow(new Date("2026-11-20T10:00:30.000Z"));
    expect(w).toEqual({
      userSince: "2026-11-20T09:59:30.000Z",
      workspaceSince: "2026-11-01T00:00:00.000Z",
    });
  });
});

describe("AI budget through the API", () => {
  beforeEach(() => {
    resetDb();
    setLLMClient(undefined);
  });
  afterEach(() => {
    delete process.env.AI_RUNS_PER_USER_PER_MINUTE;
  });

  it("answers 429 with the reason when the user runs too often", async () => {
    const { projectId } = await projectThroughGate1(); // one discovery run in the last minute
    process.env.AI_RUNS_PER_USER_PER_MINUTE = "1";
    const res = await generatePrdRoute.POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    // PF-084: every 429 carries Retry-After, the per-minute run budget's included.
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
