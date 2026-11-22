import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { agentRuns, idempotencyRecords } from "@/src/db/schema";
import { inUserTx, isUniqueViolation, isUuid, withDates } from "@/src/db/scope";
import { AppError } from "@/src/lib/errors";

import type { AgentRunRepository } from "./repository";
import { type AgentRun, STALE_RUN_MINUTES } from "./schema";
import { ALREADY_RUNNING } from "./store-repository";

const toRun = (r: typeof agentRuns.$inferSelect): AgentRun => ({
  id: r.id,
  workspaceId: r.workspaceId,
  projectId: r.projectId,
  stage: r.stage,
  provider: r.provider,
  model: r.model,
  promptVersion: r.promptVersion,
  status: r.status,
  attempts: r.attempts,
  tokensIn: r.tokensIn,
  tokensOut: r.tokensOut,
  costUsd: r.costUsd,
  latencyMs: r.latencyMs,
  inputHash: r.inputHash,
  error: r.error,
  events: r.events,
  // Null once the user's account is deleted.
  createdBy: r.createdBy ?? "",
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
});

const staleBefore = sql`now() - interval '${sql.raw(String(STALE_RUN_MINUTES))} minutes'`;

/** Supabase Postgres, as the signed-in user (PF-071, ADR-027). */
export const pgAgentRuns: AgentRunRepository = {
  insert: (scope, run) =>
    inUserTx(scope, async (tx) => {
      // A run left "running" by a server that stopped mid-run no longer blocks this one.
      await tx
        .update(agentRuns)
        .set({
          status: "failed",
          error: "Abandoned: the run stopped without finishing",
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(agentRuns.workspaceId, scope.workspace.id),
            eq(agentRuns.projectId, run.projectId),
            eq(agentRuns.stage, run.stage),
            eq(agentRuns.status, "running"),
            lt(agentRuns.createdAt, staleBefore),
          ),
        );
      try {
        const [row] = await tx
          .insert(agentRuns)
          .values({
            ...withDates(run, ["createdAt", "finishedAt"]),
            workspaceId: scope.workspace.id,
            createdBy: scope.session.userId,
          } as typeof agentRuns.$inferInsert)
          .returning();
        return toRun(row!);
      } catch (err) {
        if (isUniqueViolation(err, "agent_runs_one_running")) {
          throw new AppError("CONFLICT", ALREADY_RUNNING);
        }
        throw err;
      }
    }),

  update: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const { id: _id, workspaceId: _ws, projectId: _p, createdBy: _by, ...rest } = patch;
      const [row] = await tx
        .update(agentRuns)
        .set(withDates(rest, ["createdAt", "finishedAt"]) as Partial<typeof agentRuns.$inferInsert>)
        .where(
          and(
            eq(agentRuns.workspaceId, scope.workspace.id),
            eq(agentRuns.id, id),
            eq(agentRuns.status, "running"),
          ),
        )
        .returning();
      return row ? toRun(row) : null;
    }),

  findById: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.workspaceId, scope.workspace.id), eq(agentRuns.id, id)));
      return row ? toRun(row) : null;
    }),

  usage: (scope, { userSince, workspaceSince }) =>
    inUserTx(scope, async (tx) => {
      const ws = eq(agentRuns.workspaceId, scope.workspace.id);
      const [user] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(agentRuns)
        .where(
          and(
            ws,
            eq(agentRuns.createdBy, scope.session.userId),
            gte(agentRuns.createdAt, new Date(userSince)),
          ),
        );
      const [workspace] = await tx
        .select({
          n: sql<number>`coalesce(sum(${agentRuns.tokensIn} + ${agentRuns.tokensOut}), 0)::bigint`,
        })
        .from(agentRuns)
        .where(and(ws, gte(agentRuns.createdAt, new Date(workspaceSince))));
      return { userRuns: Number(user?.n ?? 0), workspaceTokens: Number(workspace?.n ?? 0) };
    }),

  latestForProject: (scope, projectId, stage) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return null;
      const [row] = await tx
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.workspaceId, scope.workspace.id),
            eq(agentRuns.projectId, projectId),
            eq(agentRuns.stage, stage),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      return row ? toRun(row) : null;
    }),

  findIdempotent: (scope, operation, key) =>
    inUserTx(scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.workspaceId, scope.workspace.id),
            eq(idempotencyRecords.operation, operation),
            eq(idempotencyRecords.key, key),
          ),
        );
      return row
        ? {
            workspaceId: row.workspaceId,
            scope: row.operation,
            key: row.key,
            resultId: row.resultId,
            createdAt: row.createdAt.toISOString(),
          }
        : null;
    }),

  saveIdempotent: (scope, record) =>
    inUserTx(scope, async (tx) => {
      await tx
        .insert(idempotencyRecords)
        .values({
          workspaceId: scope.workspace.id,
          operation: record.scope,
          key: record.key,
          resultId: record.resultId,
          createdBy: scope.session.userId,
          createdAt: new Date(record.createdAt),
        })
        .onConflictDoNothing();
    }),
};
