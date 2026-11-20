/**
 * Projects (PF-011, PRD FR-01). Limits mirror ProjectInput in src/modules/projects/schema.ts.
 * RLS (PF-012): members read; owners, admins and PMs create and edit; owners and admins delete —
 * the same rules as the projects service.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { createdAt, updatedAt } from "./columns";
import { ADMINS, MANAGERS, memberOf, roleIn } from "./policies";
import { workspaces } from "./workspaces";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    domain: varchar("domain", { length: 60 }).notNull(),
    audience: varchar("audience", { length: 120 }).notNull(),
    teamSize: integer("team_size").notNull(),
    sprintLengthDays: integer("sprint_length_days").notNull(),
    // Kept when the creator leaves; the audit log has their name.
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_workspace_id_idx").on(t.workspaceId),
    // Lets child tables reference (project, workspace) together, so a row can't pair a project
    // with another workspace (PF-070).
    unique("projects_id_workspace_id_key").on(t.id, t.workspaceId),
    check("projects_team_size_range", sql`${t.teamSize} between 1 and 100`),
    check("projects_sprint_length_days", sql`${t.sprintLengthDays} in (7, 14, 21, 28)`),
    pgPolicy("projects_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("projects_insert_manager", {
      for: "insert",
      to: authenticatedRole,
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    pgPolicy("projects_update_manager", {
      for: "update",
      to: authenticatedRole,
      using: roleIn(t.workspaceId, MANAGERS),
      withCheck: roleIn(t.workspaceId, MANAGERS),
    }),
    pgPolicy("projects_delete_admin", {
      for: "delete",
      to: authenticatedRole,
      using: roleIn(t.workspaceId, ADMINS),
    }),
  ],
).enableRLS();
