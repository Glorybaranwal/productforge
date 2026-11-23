import { and, desc, eq, isNull } from "drizzle-orm";

import { adminDb } from "@/src/db/client";
import { apiKeys } from "@/src/db/schema";
import { inUserTx, isUniqueViolation, isUuid, iso } from "@/src/db/scope";
import { AppError } from "@/src/lib/errors";

import type { ApiKeyRepository } from "./repository";
import { ApiKeyScope, type ApiKey } from "./schema";

/** Maps a row to the client-facing type. Picks fields one by one: the hash is never copied. */
const toApiKey = (row: typeof apiKeys.$inferSelect): ApiKey => ({
  id: row.id,
  workspaceId: row.workspaceId,
  userId: row.userId,
  name: row.name,
  prefix: row.prefix,
  scope: ApiKeyScope.parse(row.scope),
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: iso(row.lastUsedAt),
  expiresAt: row.expiresAt.toISOString(),
  revokedAt: iso(row.revokedAt),
});

/** Supabase Postgres, as the signed-in user: RLS applies to every statement (PF-083, ADR-036). */
export const pgApiKeys: ApiKeyRepository = {
  listForUser: (scope, userId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(userId)) return [];
      const rows = await tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.workspaceId, scope.workspace.id), eq(apiKeys.userId, userId)))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(toApiKey);
    }),

  listForWorkspace: (scope) =>
    inUserTx(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.workspaceId, scope.workspace.id))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(toApiKey);
    }),

  async insert(scope, key) {
    try {
      return await inUserTx(scope, async (tx) => {
        const [row] = await tx
          .insert(apiKeys)
          .values({
            id: key.id,
            workspaceId: key.workspaceId,
            userId: key.userId,
            name: key.name,
            prefix: key.prefix,
            secretHash: key.secretHash,
            scope: key.scope,
            createdAt: new Date(key.createdAt),
            lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
            expiresAt: new Date(key.expiresAt),
            revokedAt: key.revokedAt ? new Date(key.revokedAt) : null,
          })
          .returning();
        return toApiKey(row!);
      });
    } catch (err) {
      if (isUniqueViolation(err, "api_keys_prefix_key"))
        throw new AppError("CONFLICT", "That key prefix is already in use");
      throw err;
    }
  },

  revoke: (scope, id, at) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) throw new AppError("NOT_FOUND", "API key not found");
      const [revoked] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date(at) })
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.workspaceId, scope.workspace.id),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning();
      if (revoked) return toApiKey(revoked);
      // Nothing changed: already revoked (return it as it is), or not visible to this user.
      const [existing] = await tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, scope.workspace.id)))
        .limit(1);
      if (!existing) throw new AppError("NOT_FOUND", "API key not found");
      return toApiKey(existing);
    }),

  /**
   * Bypasses RLS on purpose: the verify path runs before anyone is authenticated, so there is no
   * `auth.uid()` for a policy to check. Reads only what verification needs. Never call this from a
   * route: it would let a caller probe keys by prefix.
   */
  async findByPrefix(prefix) {
    const [row] = await adminDb()
      .select({
        id: apiKeys.id,
        workspaceId: apiKeys.workspaceId,
        userId: apiKeys.userId,
        prefix: apiKeys.prefix,
        scope: apiKeys.scope,
        secretHash: apiKeys.secretHash,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.prefix, prefix))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      prefix: row.prefix,
      scope: ApiKeyScope.parse(row.scope),
      secretHash: row.secretHash,
      lastUsedAt: iso(row.lastUsedAt),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: iso(row.revokedAt),
    };
  },

  /**
   * Bypasses RLS on purpose, for the same reason as `findByPrefix`: it runs while authenticating,
   * before there is a user. Writes `last_used_at` only. Never call this from a route.
   */
  async touchLastUsed(id, at) {
    await adminDb()
      .update(apiKeys)
      .set({ lastUsedAt: new Date(at) })
      .where(eq(apiKeys.id, id));
  },
};
