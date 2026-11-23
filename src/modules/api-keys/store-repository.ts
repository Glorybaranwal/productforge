import { readState, transact } from "@/src/db/store";
import type { DbState } from "@/src/db/state";
import { AppError } from "@/src/lib/errors";

import type { ApiKeyRepository } from "./repository";
import type { WorkspaceScope } from "@/src/db/scope";

import type { ApiKey, NewApiKey } from "./schema";

/** The stored record minus the hash. Built field by field so the hash can never ride along. */
const strip = (k: NewApiKey): ApiKey => ({
  id: k.id,
  workspaceId: k.workspaceId,
  userId: k.userId,
  name: k.name,
  prefix: k.prefix,
  scope: k.scope,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
  expiresAt: k.expiresAt,
  revokedAt: k.revokedAt,
});

const newestFirst = (a: ApiKey, b: ApiKey) => b.createdAt.localeCompare(a.createdAt);

const inWorkspace = (state: DbState, workspaceId: string) =>
  state.apiKeys.filter((k) => k.workspaceId === workspaceId);

/**
 * The select and update policies, kept in the demo store: a caller sees (and may revoke) their own
 * keys, and owners and admins see every key in the workspace. Without this a service that forgot a
 * role check would leak names, prefixes and last-used times in demo mode only.
 */
const canSee = (state: DbState, scope: WorkspaceScope, key: NewApiKey) =>
  key.userId === scope.session.userId ||
  state.workspaceMembers.some(
    (m) =>
      m.workspaceId === key.workspaceId &&
      m.userId === scope.session.userId &&
      (m.role === "owner" || m.role === "admin"),
  );

/** Demo store (ADR-011). Its only access control is `canSee` and the checks in `insert`. */
export const storeApiKeys: ApiKeyRepository = {
  async listForUser(scope, userId) {
    const state = await readState();
    return inWorkspace(state, scope.workspace.id)
      .filter((k) => k.userId === userId && canSee(state, scope, k))
      .map(strip)
      .sort(newestFirst);
  },

  async listForWorkspace(scope) {
    const state = await readState();
    return inWorkspace(state, scope.workspace.id)
      .filter((k) => canSee(state, scope, k))
      .map(strip)
      .sort(newestFirst);
  },

  async insert(scope, key) {
    return transact((state) => {
      // The database's composite foreign key and the insert policy, kept in the demo store.
      if (key.workspaceId !== scope.workspace.id || key.userId !== scope.session.userId)
        throw new AppError("FORBIDDEN", "You don't have access to do that");
      if (
        !state.workspaceMembers.some(
          (m) => m.workspaceId === key.workspaceId && m.userId === key.userId,
        )
      )
        throw new AppError("FORBIDDEN", "You don't have access to do that");
      if (state.apiKeys.some((k) => k.prefix === key.prefix))
        throw new AppError("CONFLICT", "That key prefix is already in use");
      state.apiKeys.push({ ...key });
      return strip(key);
    });
  },

  async revoke(scope, id, at) {
    return transact((state) => {
      // A key the caller can't see is "not found", as under RLS.
      const key = inWorkspace(state, scope.workspace.id).find(
        (k) => k.id === id && canSee(state, scope, k),
      );
      if (!key) throw new AppError("NOT_FOUND", "API key not found");
      key.revokedAt ??= at;
      return strip(key);
    });
  },

  // Admin path: the caller is not signed in yet. Never call from a route.
  async findByPrefix(prefix) {
    const state = await readState();
    const k = state.apiKeys.find((x) => x.prefix === prefix);
    return k
      ? {
          id: k.id,
          workspaceId: k.workspaceId,
          userId: k.userId,
          prefix: k.prefix,
          scope: k.scope,
          lastUsedAt: k.lastUsedAt,
          expiresAt: k.expiresAt,
          revokedAt: k.revokedAt,
          secretHash: k.secretHash,
        }
      : null;
  },

  async touchLastUsed(id, at) {
    await transact((state) => {
      const key = state.apiKeys.find((k) => k.id === id);
      if (key) key.lastUsedAt = at;
    });
  },
};
