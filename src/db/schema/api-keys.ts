/**
 * Workspace API keys for service-to-service calls (PF-083, ADR-036). A key acts as the member who
 * created it, so it is bound to `(workspace_id, user_id)` and dies with that membership. Only a
 * SHA-256 hash and a short non-secret prefix are stored (never the plaintext).
 *
 * RLS: a member sees their own keys, owners and admins see the workspace's. A key is inserted for
 * yourself only. The only updates are revoking and `last_used_at` (the column grants in migration
 * `0010_api_keys.sql` pin that down), and nobody deletes a key: they are revoked, so the audit trail
 * survives. The verify path runs before anyone is signed in, so it uses `adminDb()`.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUsers } from "drizzle-orm/supabase";

import { createdAt } from "./columns";
import { ADMINS, isMe, memberOf, roleIn } from "./policies";
import { workspaceMembers } from "./workspaces";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scope: text("scope").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // A key stays inside the workspace its owner belongs to (ADR-026); removing the member removes
    // their keys.
    foreignKey({
      name: "api_keys_member_fk",
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete("cascade"),
    uniqueIndex("api_keys_prefix_key").on(t.prefix),
    index("api_keys_member_idx").on(t.workspaceId, t.userId),
    check("api_keys_scope", sql`${t.scope} in ('read', 'write')`),
    pgPolicy("api_keys_select_own_or_admin", {
      for: "select",
      to: authenticatedRole,
      using: sql`${isMe(t.userId)} or ${roleIn(t.workspaceId, ADMINS)}`,
    }),
    pgPolicy("api_keys_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${memberOf(t.workspaceId)} and ${isMe(t.userId)}`,
    }),
    // Only a live key can change (a revoked one stays revoked), and only by its owner or an admin.
    pgPolicy("api_keys_update_own_or_admin", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.revokedAt} is null and (${isMe(t.userId)} or ${roleIn(t.workspaceId, ADMINS)})`,
      withCheck: sql`${isMe(t.userId)} or ${roleIn(t.workspaceId, ADMINS)}`,
    }),
  ],
).enableRLS();
