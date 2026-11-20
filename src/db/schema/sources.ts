/**
 * Source notes a project's discovery reads (PF-070, ADR-026). The text is untrusted data, never
 * instructions (CLAUDE.md §7.8). Members add and remove sources; nobody edits one in place.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { MAX_SOURCE_CHARS } from "../../modules/sources/schema";

import { createdAt } from "./columns";
import { isMe, memberOf } from "./policies";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const sourceKind = pgEnum("source_kind", ["paste", "file"]);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kind: sourceKind("kind").notNull(),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "source_documents_project_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    index("source_documents_project_idx").on(t.workspaceId, t.projectId),
    check(
      "source_documents_text_length",
      sql`length(${t.text}) <= ${sql.raw(String(MAX_SOURCE_CHARS))} and ${t.charCount} = length(${t.text})`,
    ),
    pgPolicy("source_documents_select_member", {
      for: "select",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
    pgPolicy("source_documents_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${isMe(t.createdBy)}`,
    }),
    pgPolicy("source_documents_delete_member", {
      for: "delete",
      to: authenticatedRole,
      using: memberOf(t.workspaceId),
    }),
  ],
).enableRLS();
