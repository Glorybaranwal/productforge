import { AppError } from "@/src/lib/errors";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { RunUsage } from "@/src/modules/agent-runs/schema";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

/** Defaults when the env doesn't say (ADR-035). A backlog generation is 3 runs. */
export const DEFAULT_RUNS_PER_MINUTE = 12;
export const DEFAULT_MONTHLY_TOKENS = 2_000_000;

type Env = Record<string, string | undefined>;
const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function budgetLimits(env: Env = process.env) {
  return {
    runsPerMinute: positive(env.AI_RUNS_PER_USER_PER_MINUTE, DEFAULT_RUNS_PER_MINUTE),
    monthlyTokens: positive(env.AI_MONTHLY_TOKEN_BUDGET_PER_WORKSPACE, DEFAULT_MONTHLY_TOKENS),
  };
}

/** The usage windows at `now`: the last minute for the user, the calendar month (UTC) for the workspace. */
export function usageWindow(now: Date) {
  return {
    userSince: new Date(now.getTime() - 60_000).toISOString(),
    workspaceSince: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
  };
}

/** Pure decision, so it's unit-tested without a clock or a database. */
export function budgetError(
  usage: RunUsage,
  limits: ReturnType<typeof budgetLimits>,
  now: Date = new Date(),
): AppError | null {
  if (usage.userRuns >= limits.runsPerMinute)
    return new AppError(
      "RATE_LIMITED",
      "Too many AI runs in the last minute. Wait a minute and try again.",
      {
        retryAfterSeconds: 60,
      },
    );
  if (usage.workspaceTokens >= limits.monthlyTokens)
    return new AppError(
      "RATE_LIMITED",
      "This workspace has used its AI budget for the month. It resets on the 1st (UTC); an owner can raise it.",
      {
        limit: limits.monthlyTokens,
        used: usage.workspaceTokens,
        // The budget resets at the start of next month (UTC), so a client should wait until then.
        // Always >= 1: `now` is before the first of next month by definition.
        retryAfterSeconds: Math.ceil(
          (Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 1000,
        ),
      },
    );
  return null;
}

/** Throws RATE_LIMITED (429) before a run starts when the user or the workspace is over budget. */
export async function checkRunBudget(ctx: WorkspaceContext, now = new Date()): Promise<void> {
  const usage = await agentRunRepository.usage(ctx, usageWindow(now));
  const error = budgetError(usage, budgetLimits(), now);
  if (error) throw error;
}
