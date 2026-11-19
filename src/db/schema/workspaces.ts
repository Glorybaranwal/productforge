/**
 * Workspaces and their members (PF-011, ADR-019). Users live in Supabase Auth (`auth.users`).
 * RLS policies (PF-012, ADR-020): members see their workspaces and teammates; owners and admins
 * manage them. Ownership never changes through user-level access.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { createdAt, updatedAt } from "./columns";
import { ADMINS, isMe, isOwnerOf, managesMember, memberOf, roleIn } from "./policies";

/** Same values as ROLES in src/lib/auth.ts (a unit test keeps them in step). */
export const MEMBER_ROLES = ["owner", "admin", "pm", "developer", "qa"] as const;
export const memberRole = pgEnum("member_role", MEMBER_ROLES);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }).notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("workspaces_owner_id_idx").on(t.ownerId),
    check("workspaces_name_not_blank", sql`length(trim(${t.name})) > 0`),
    pgPolicy("workspaces_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${isMe(t.ownerId)} or ${memberOf(t.id)}`,
    }),
    pgPolicy("workspaces_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: isMe(t.ownerId),
    }),
    // Owners and admins rename; nobody hands the workspace to someone else from here.
    pgPolicy("workspaces_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: roleIn(t.id, ADMINS),
      withCheck: sql`${roleIn(t.id, ADMINS)} and ${isOwnerOf(t.id, t.ownerId)}`,
    }),
    pgPolicy("workspaces_delete_owner", {
      for: "delete",
      to: authenticatedRole,
      using: isMe(t.ownerId),
    }),
  ],
).enableRLS();

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    // "Which workspaces am I in?" — also what the RLS policies look up.
    index("workspace_members_user_id_idx").on(t.userId),
    // Your own memberships and your teammates'. `isMe` lets `insert … returning` see the new row.
    pgPolicy("workspace_members_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${isMe(t.userId)} or ${memberOf(t.workspaceId)}`,
    }),
    // The owner of a new workspace joins it as owner; owners and admins add everyone else
    // (only owners add owners).
    pgPolicy("workspace_members_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(${isMe(t.userId)} and ${t.role} = 'owner' and ${isOwnerOf(t.workspaceId, authUid)}) or ${managesMember(t.workspaceId, t.role)}`,
    }),
    pgPolicy("workspace_members_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: managesMember(t.workspaceId, t.role),
      withCheck: managesMember(t.workspaceId, t.role),
    }),
    // Leave a workspace yourself, or be removed by an owner (or an admin, unless you're an owner).
    pgPolicy("workspace_members_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${isMe(t.userId)} or ${managesMember(t.workspaceId, t.role)}`,
    }),
  ],
).enableRLS();
