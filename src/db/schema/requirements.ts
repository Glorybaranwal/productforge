/**
 * Discovery data (PF-070, ADR-026): versioned requirements, clarifying questions and the latest discovery
 * result per project. Enum values come from the domain schema (ADR-003). RLS mirrors the product
 * rules: members read and edit drafts; owners, admins and PMs run discovery and approve; an
 * APPROVED row is never changed in place — a change is a new version (ADR-006).
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import {
  type Ambiguity,
  ARTIFACT_STATUS,
  type Conflict,
  EVIDENCE,
  ORIGINS,
  QUESTION_STATES,
  REQUIREMENT_TYPES,
} from "../../modules/requirements/schema";

import { createdAt, updatedAt } from "./columns";
import { MANAGERS, memberOf, roleIn } from "./policies";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const requirementType = pgEnum("requirement_type", REQUIREMENT_TYPES);
export const evidenceLabel = pgEnum("evidence_label", EVIDENCE);
export const artifactStatus = pgEnum("artifact_status", ARTIFACT_STATUS);
export const artifactOrigin = pgEnum("artifact_origin", ORIGINS);
export const questionState = pgEnum("question_state", QUESTION_STATES);
export const discoveryStatus = pgEnum("discovery_status", ["draft", "confirmed"]);

const ownerColumns = () => ({
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
});

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownerColumns(),
    code: varchar("code", { length: 12 }).notNull(),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    type: requirementType("type").notNull(),
    evidence: evidenceLabel("evidence").notNull(),
    sourceQuote: text("source_quote"),
    rationale: text("rationale"),
    sourceId: text("source_id"),
    status: artifactStatus("status").notNull(),
    origin: artifactOrigin("origin").notNull(),
    // Becomes a foreign key when agent runs move to Postgres (PF-071).
    agentRunId: uuid("agent_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    approvedBy: uuid("approved_by").references(() => authUsers.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "requirements_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    unique("requirements_project_code_version_key").on(t.projectId, t.code, t.version),
    index("requirements_project_idx").on(t.workspaceId, t.projectId),
    check("requirements_code_format", sql`${t.code} ~ '^N?FR-[0-9]{2,}$'`),
    check("requirements_version_positive", sql`${t.version} > 0`),
    check("requirements_text_length", sql`length(${t.text}) between 1 and 2000`),
    pgPolicy("requirements_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    // Anyone in the workspace adds requirements; only owners, admins and PMs add approved ones.
    pgPolicy("requirements_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and (${t.status} <> 'APPROVED' or ${roleIn(t.workspaceId, MANAGERS)})`,
    }),
    // Drafts are editable by members; approving takes a manager; approved rows never change.
    pgPolicy("requirements_update_draft", {
      for: "update",
      to: authenticatedRole,
      using: sql`${memberOf(t.workspaceId)} and ${t.status} <> 'APPROVED'`,
      withCheck: sql`${memberOf(t.workspaceId)} and (${t.status} <> 'APPROVED' or ${roleIn(t.workspaceId, MANAGERS)})`,
    }),
    // A new discovery run replaces the previous run's untouched AI drafts.
    pgPolicy("requirements_delete_ai_draft", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${roleIn(t.workspaceId, MANAGERS)} and ${t.status} = 'DRAFT' and ${t.origin} = 'ai'`,
    }),
  ],
).enableRLS();

export const clarifyingQuestions = pgTable(
  "clarifying_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...ownerColumns(),
    question: text("question").notNull(),
    reason: text("reason").notNull(),
    state: questionState("state").notNull(),
    answer: text("answer"),
    agentRunId: uuid("agent_run_id"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "clarifying_questions_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    index("clarifying_questions_project_idx").on(t.workspaceId, t.projectId),
    pgPolicy("clarifying_questions_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    // Discovery runs (owners, admins, PMs) ask and replace questions; any member answers them.
    pgPolicy("clarifying_questions_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    pgPolicy("clarifying_questions_update_member", {
      for: "update",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
      withCheck: memberOf(t.workspaceId),
    }),
    pgPolicy("clarifying_questions_delete_open", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${roleIn(t.workspaceId, MANAGERS)} and ${t.state} = 'open'`,
    }),
  ],
).enableRLS();

/** The latest discovery result per project, and Gate 1 (confirmation). */
export const discoveries = pgTable(
  "discoveries",
  {
    projectId: uuid("project_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").notNull(),
    runCount: integer("run_count").notNull(),
    summary: text("summary").notNull(),
    actors: jsonb("actors").$type<string[]>().notNull(),
    goals: jsonb("goals").$type<string[]>().notNull(),
    constraints: jsonb("constraints").$type<string[]>().notNull(),
    conflicts: jsonb("conflicts").$type<Conflict[]>().notNull(),
    ambiguities: jsonb("ambiguities").$type<Ambiguity[]>().notNull(),
    status: discoveryStatus("status").notNull(),
    updatedAt: updatedAt(),
    /** Who confirmed Gate 1, by name (a snapshot, like `audit_logs.actor_name`). */
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "discoveries_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    check("discoveries_run_count_positive", sql`${t.runCount} > 0`),
    pgPolicy("discoveries_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("discoveries_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    pgPolicy("discoveries_update_manager", {
      for: "update",
      to: authenticatedRole,
      using: roleIn(t.workspaceId, MANAGERS),
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
  ],
).enableRLS();
