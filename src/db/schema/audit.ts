/**
 * Audit trail (PF-011): append-only. The actor's name is copied in, so an entry still reads
 * correctly after the user is deleted. RLS (PF-012): members read their workspace's entries and add
 * entries as themselves; there is no update or delete policy, so nobody can rewrite history.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { createdAt } from "./columns";
import { isMe, memberOf } from "./policies";
import { workspaces } from "./workspaces";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => authUsers.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    entityType: text("entity_type").notNull(),
    /** A UUID or a human code (FR-01, US-003), so text. */
    entityId: text("entity_id").notNull(),
    /** Dotted verb, e.g. `project.created`. */
    action: text("action").notNull(),
    /** For updates: `{ field: { from, to } }`. */
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    // The activity feed: one entity's history, newest first.
    index("audit_logs_entity_idx").on(t.workspaceId, t.entityType, t.entityId, t.createdAt.desc()),
    pgPolicy("audit_logs_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("audit_logs_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${isMe(t.actorId)}`,
    }),
  ],
).enableRLS();
