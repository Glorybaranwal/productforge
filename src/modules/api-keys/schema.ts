import { z } from "zod";

/** `read` can only read; `write` can also write. No scope can approve (ADR-036, CLAUDE.md §7.7). */
export const API_KEY_SCOPES = ["read", "write"] as const;
export const ApiKeyScope = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

/** A key as clients see it. It never carries the secret hash, let alone the plaintext. */
export const ApiKey = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** The member the key acts as. */
  userId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  /** Eight lowercase base32 characters: lookup and log correlation, not secret. */
  prefix: z.string().regex(/^[a-z2-7]{8}$/),
  scope: ApiKeyScope,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

/** What `insert` stores: the key plus its SHA-256 hash. Only the service that mints a key builds one. */
export type NewApiKey = ApiKey & { secretHash: string };

/**
 * What the verify path reads (`findByPrefix`): just the columns it needs, including the hash. Used
 * only inside the verify path, so a hash reaching a response is a type error (it is not an `ApiKey`
 * field, and the repository's other methods return `ApiKey`).
 */
export type ApiKeyWithSecret = Pick<
  ApiKey,
  "id" | "workspaceId" | "userId" | "prefix" | "scope" | "expiresAt" | "revokedAt"
> & { secretHash: string };
