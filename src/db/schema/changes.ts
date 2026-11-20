/**
 * Requirement change requests and impact reviews (PF-074, ADR-030). A proposed change (DRAFT) is
 * analysed and then approved or discarded by an owner, admin or PM; a decided change never changes.
 * Review marks are written once. Members read both.
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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import {
  type Affected,
  CHANGE_KINDS,
  type ImpactOutput,
  type RequirementSnapshot,
} from "../../modules/impact/schema";

import { agentRuns } from "./agent-runs";
import { createdAt } from "./columns";
import { MANAGERS, memberOf, roleIn } from "./policies";
import { projects } from "./projects";
import { artifactStatus } from "./requirements";
import { workspaces } from "./workspaces";

export const changeKind = pgEnum("change_kind", CHANGE_KINDS);

export const requirementChanges = pgTable(
  "requirement_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    number: integer("number").notNull(),
    kind: changeKind("kind").notNull(),
    requirementCode: varchar("requirement_code", { length: 12 }),
    fromVersion: integer("from_version"),
    toVersion: integer("to_version"),
    before: jsonb("before").$type<RequirementSnapshot>(),
    after: jsonb("after").$type<RequirementSnapshot>(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: artifactStatus("status").notNull(),
    affected: jsonb("affected").$type<Affected>().notNull(),
    impact: jsonb("impact").$type<ImpactOutput>(),
    agentRunId: uuid("agent_run_id"),
    // People by name (snapshots); the audit log has their ids.
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "requirement_changes_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "requirement_changes_agent_run_fk",
      columns: [t.agentRunId, t.workspaceId],
      foreignColumns: [agentRuns.id, agentRuns.workspaceId],
    }),
    unique("requirement_changes_id_workspace_id_key").on(t.id, t.workspaceId),
    unique("requirement_changes_project_number_key").on(t.projectId, t.number),
    index("requirement_changes_project_idx").on(t.workspaceId, t.projectId),
    check("requirement_changes_status", sql`${t.status} in ('DRAFT', 'APPROVED', 'REJECTED')`),
    pgPolicy("requirement_changes_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("requirement_changes_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${roleIn(t.workspaceId, MANAGERS)} and ${t.status} = 'DRAFT'`,
    }),
    // Proposed changes are analysed, then approved or discarded; decided ones never change.
    pgPolicy("requirement_changes_update_proposed", {
      for: "update",
      to: authenticatedRole,
      using: sql`${roleIn(t.workspaceId, MANAGERS)} and ${t.status} = 'DRAFT'`,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
  ],
).enableRLS();

export const impactReviews = pgTable(
  "impact_reviews",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    changeId: uuid("change_id").notNull(),
    // "PRD" or a story code.
    ref: varchar("ref", { length: 12 }).notNull(),
    note: varchar("note", { length: 300 }).notNull(),
    reviewedBy: text("reviewed_by").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "impact_reviews_pkey", columns: [t.changeId, t.ref] }),
    foreignKey({
      name: "impact_reviews_change_fk",
      columns: [t.changeId, t.workspaceId],
      foreignColumns: [requirementChanges.id, requirementChanges.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "impact_reviews_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    check("impact_reviews_ref", sql`${t.ref} = 'PRD' or ${t.ref} ~ '^US-[0-9]{3,}$'`),
    pgPolicy("impact_reviews_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("impact_reviews_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
  ],
).enableRLS();
