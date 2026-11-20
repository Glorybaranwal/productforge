/**
 * The AI run log and idempotency records (PF-071, ADR-027). Every stage run is one row; requirements,
 * questions and the discovery summary point at the run that wrote them. Members read the log; a run
 * is finished only by whoever started it (or by anyone once it was abandoned); nobody deletes one.
 */
import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import {
  type RunEvent,
  RUN_STATUSES,
  STAGES,
  STALE_RUN_MINUTES,
} from "../../modules/agent-runs/schema";

import { createdAt } from "./columns";
import { isMe, memberOf } from "./policies";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const agentStage = pgEnum("agent_stage", STAGES);
export const runStatus = pgEnum("run_status", RUN_STATUSES);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    stage: agentStage("stage").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 100 }).notNull(),
    status: runStatus("status").notNull(),
    attempts: integer("attempts").notNull(),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    // Null when the provider's pricing isn't configured.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    latencyMs: integer("latency_ms").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    error: text("error"),
    events: jsonb("events").$type<RunEvent[]>().notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "agent_runs_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    // Rows that point at a run must point at one in their own workspace.
    unique("agent_runs_id_workspace_id_key").on(t.id, t.workspaceId),
    // One run of a stage per project at a time: a second click or tab gets "already running".
    // Keyed by workspace too, so one tenant's runs can never collide with another's.
    uniqueIndex("agent_runs_one_running")
      .on(t.workspaceId, t.projectId, t.stage)
      .where(sql`${t.status} = 'running'`),
    index("agent_runs_latest_idx").on(t.workspaceId, t.projectId, t.stage, t.createdAt),
    pgPolicy("agent_runs_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("agent_runs_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${isMe(t.createdBy)} and ${t.status} = 'running'`,
    }),
    // A running run is finished by whoever started it, or by anyone once it was abandoned.
    // Finished runs never change.
    pgPolicy("agent_runs_finish", {
      for: "update",
      to: authenticatedRole,
      using: sql`${memberOf(t.workspaceId)} and ${t.status} = 'running' and (${isMe(t.createdBy)} or ${t.createdAt} < now() - interval '${sql.raw(String(STALE_RUN_MINUTES))} minutes')`,
      withCheck: memberOf(t.workspaceId),
    }),
  ],
).enableRLS();

/** A repeated request with the same `Idempotency-Key` returns the first result (CLAUDE.md §8). */
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // What was asked, e.g. "discovery:<project id>".
    operation: varchar("operation", { length: 120 }).notNull(),
    key: varchar("key", { length: 200 }).notNull(),
    // A run id, a change id, or several run ids: whatever the operation returns.
    resultId: text("result_id").notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "idempotency_records_pkey", columns: [t.workspaceId, t.operation, t.key] }),
    pgPolicy("idempotency_records_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("idempotency_records_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${isMe(t.createdBy)}`,
    }),
  ],
).enableRLS();
