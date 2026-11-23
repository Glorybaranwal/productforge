import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgApiKeys } from "./pg-repository";
import type { ApiKey, ApiKeyWithSecret, NewApiKey } from "./schema";
import { storeApiKeys } from "./store-repository";

export interface ApiKeyRepository {
  /** The user's own keys in this workspace, newest first. */
  listForUser(scope: WorkspaceScope, userId: string): Promise<ApiKey[]>;
  /** Every key in the workspace, newest first. Under RLS only owners and admins get others' keys. */
  listForWorkspace(scope: WorkspaceScope): Promise<ApiKey[]>;
  /** Stores a new key for `scope.session.userId`; returns it without the hash. */
  insert(scope: WorkspaceScope, key: NewApiKey): Promise<ApiKey>;
  /** Sets `revokedAt` once; revoking a revoked key returns it unchanged. NOT_FOUND if not visible. */
  revoke(scope: WorkspaceScope, id: string, at: string): Promise<ApiKey>;
  /**
   * Lookup for the auth path. Runs as the admin client: the caller is not yet authenticated.
   * Never call it from a route.
   */
  findByPrefix(prefix: string): Promise<ApiKeyWithSecret | null>;
  /** Records a use. Admin client, like `findByPrefix`; never call it from a route. */
  touchLastUsed(id: string, at: string): Promise<void>;
}

const pick = (): ApiKeyRepository => (dataBackend() === "postgres" ? pgApiKeys : storeApiKeys);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022). */
export const apiKeyRepository: ApiKeyRepository = {
  listForUser: (...a) => pick().listForUser(...a),
  listForWorkspace: (...a) => pick().listForWorkspace(...a),
  insert: (...a) => pick().insert(...a),
  revoke: (...a) => pick().revoke(...a),
  findByPrefix: (...a) => pick().findByPrefix(...a),
  touchLastUsed: (...a) => pick().touchLastUsed(...a),
};
