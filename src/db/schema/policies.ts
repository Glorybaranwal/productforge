/**
 * Building blocks for the RLS policies (PF-012, ADR-020). Every policy is for the `authenticated`
 * role; `anon` gets no policy, so it reads nothing. `(select auth.uid())` is evaluated once per
 * statement, not per row (Supabase's guidance).
 *
 * Membership checks call the SECURITY DEFINER functions in the `private` schema (migration
 * `0001_rls_helpers.sql`). They read `workspace_members` / `workspaces` as the table owner, which RLS
 * doesn't apply to. Querying those tables straight from their own policies (or from each other's)
 * makes Postgres fail with "infinite recursion detected in policy". Supabase's Data API doesn't
 * expose `private`, so the functions can't be called from outside.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { authUid } from "drizzle-orm/supabase";

export type MemberRoleName = "owner" | "admin" | "pm" | "developer" | "qa";

export const MANAGERS: MemberRoleName[] = ["owner", "admin", "pm"];
export const ADMINS: MemberRoleName[] = ["owner", "admin"];

const roleList = (roles: MemberRoleName[]): SQL =>
  sql.raw(`array[${roles.map((r) => `'${r}'`).join(", ")}]`);

/** The signed-in user is a member of the row's workspace. */
export const memberOf = (workspaceId: AnyPgColumn): SQL => sql`private.is_member(${workspaceId})`;

/** The signed-in user has one of these roles in the row's workspace. */
export const roleIn = (workspaceId: AnyPgColumn, roles: MemberRoleName[]): SQL =>
  sql`private.has_role(${workspaceId}, ${roleList(roles)})`;

/** `userId` is the workspace's owner as stored (before the statement's own changes). */
export const isOwnerOf = (workspaceId: AnyPgColumn, userId: AnyPgColumn | SQL): SQL =>
  sql`private.workspace_owner(${workspaceId}) = ${userId}`;

/**
 * Owners manage any membership; admins manage everyone except owners and can't make anyone an
 * owner (no self-promotion). `role` is the membership's role — old row in USING, new row in CHECK.
 */
export const managesMember = (workspaceId: AnyPgColumn, role: AnyPgColumn): SQL =>
  sql`(${roleIn(workspaceId, ["owner"])} or (${roleIn(workspaceId, ["admin"])} and ${role} <> 'owner'))`;

/** The column holds the signed-in user's id. */
export const isMe = (userId: AnyPgColumn): SQL => sql`${userId} = ${authUid}`;
