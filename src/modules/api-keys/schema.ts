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
/**
 * `secretHash?: never` makes the type nominal against the hash: a value that carries a string
 * `secretHash` (a `NewApiKey`, an `ApiKeyWithSecret`) is not assignable to `ApiKey`, so returning
 * one where an `ApiKey` is expected is a compile error, not a leak. TypeScript's excess-property
 * check alone only covers fresh object literals.
 */
export type ApiKey = z.infer<typeof ApiKey> & { secretHash?: never };

/** What `insert` stores: the key plus its SHA-256 hash. Only the service that mints a key builds one. */
export type NewApiKey = Omit<ApiKey, "secretHash"> & { secretHash: string };

/**
 * What the verify path reads (`findByPrefix`): just the columns it needs, including the hash. Used
 * only inside the verify path, so a hash reaching a response is a type error (it is not an `ApiKey`
 * field, and the repository's other methods return `ApiKey`).
 */
export type ApiKeyWithSecret = Pick<
  ApiKey,
  "id" | "workspaceId" | "userId" | "prefix" | "scope" | "expiresAt" | "revokedAt"
> & { secretHash: string };

/**
 * What a member sends to create a key. `expiresAt` is optional (the service defaults it to 90 days)
 * and is checked against the table's window in the service, so a bad date is a 400, not a raw 23514.
 */
export const ApiKeyCreate = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(80),
  scope: ApiKeyScope,
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type ApiKeyCreate = z.infer<typeof ApiKeyCreate>;
