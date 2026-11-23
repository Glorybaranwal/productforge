import type { ApiKey } from "@/src/modules/api-keys/schema";

export type ApiKeyStatus = "active" | "expired" | "revoked";

/** Revoked wins over expired: a revoked key stays revoked after its date passes. */
export function apiKeyStatus(key: Pick<ApiKey, "revokedAt" | "expiresAt">, now = Date.now()) {
  if (key.revokedAt) return "revoked" as const;
  if (new Date(key.expiresAt).getTime() <= now) return "expired" as const;
  return "active" as const;
}
