/**
 * PRD versions (PF-072, ADR-028). Content is one JSONB document per version. Members read and edit
 * drafts; only owners, admins and PMs approve; an approved version never changes (ADR-006), and a
 * project has at most one open draft. Nobody deletes a version.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import type { PrdContent } from "../../modules/prd/schema";

import { agentRuns } from "./agent-runs";
import { createdAt, updatedAt } from "./columns";
import { isMe, MANAGERS, memberOf, roleIn } from "./policies";
import { projects } from "./projects";
import { artifactOrigin, artifactStatus } from "./requirements";
import { workspaces } from "./workspaces";

export const prds = pgTable(
  "prds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").$type<PrdContent>().notNull(),
    status: artifactStatus("status").notNull(),
    origin: artifactOrigin("origin").notNull(),
    agentRunId: uuid("agent_run_id"),
    // The approved version this draft was copied from, if any.
    basedOnVersion: integer("based_on_version"),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Who approved it, by name (a snapshot, like `discoveries.confirmed_by`).
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "prds_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "prds_agent_run_fk",
      columns: [t.agentRunId, t.workspaceId],
      foreignColumns: [agentRuns.id, agentRuns.workspaceId],
    }),
    unique("prds_project_version_key").on(t.projectId, t.version),
    // At most one open draft per project: generating, editing and "edit as n+1" all work on it.
    uniqueIndex("prds_one_draft")
      .on(t.workspaceId, t.projectId)
      .where(sql`${t.status} = 'DRAFT'`),
    index("prds_project_idx").on(t.workspaceId, t.projectId),
    check("prds_status", sql`${t.status} in ('DRAFT', 'APPROVED')`),
    check("prds_version_positive", sql`${t.version} > 0`),
    pgPolicy("prds_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    // New versions start as drafts, written by the person asking for them.
    pgPolicy("prds_insert_draft", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${t.status} = 'DRAFT' and ${isMe(t.createdBy)}`,
    }),
    // Drafts are editable by members; approving takes a manager; approved versions never change.
    pgPolicy("prds_update_draft", {
      for: "update",
      to: authenticatedRole,
      using: sql`${memberOf(t.workspaceId)} and ${t.status} = 'DRAFT'`,
      withCheck: sql`${memberOf(t.workspaceId)} and (${t.status} = 'DRAFT' or ${roleIn(t.workspaceId, MANAGERS)})`,
    }),
  ],
).enableRLS();
