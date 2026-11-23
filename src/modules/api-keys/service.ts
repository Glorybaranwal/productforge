/**
 * Workspace API keys (PF-083, ADR-036): creating, listing and revoking them, and the verify path that
 * turns a key into the `WorkspaceContext` of the member who created it. The plaintext key exists in
 * exactly one place, the return value of `createApiKey`: it is never stored, logged or audited.
 */
import { unitOfWork } from "@/src/db/scope";
import { mintApiKey, parseApiKey, secretMatches, type KeyEnv } from "@/src/lib/api-key";
import { effectiveRole, type Session } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import { recordAudit } from "@/src/modules/audit/service";
import { workspaceRepository } from "@/src/modules/workspaces/repository";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { apiKeyRepository } from "./repository";
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_MAX_EXPIRY_DAYS,
  ApiKeyCreate,
  type ApiKey,
  type NewApiKey,
} from "./schema";

/** The lifetimes live in the schema so the settings screen can show the same numbers. */
export const DEFAULT_EXPIRY_DAYS = API_KEY_DEFAULT_EXPIRY_DAYS;
export const MAX_EXPIRY_DAYS = API_KEY_MAX_EXPIRY_DAYS;
const DAY_MS = 864e5;

/** Live keys in production, test keys everywhere else; the env is only a label in the key. */
const keyEnv = (): KeyEnv => (process.env.VERCEL_ENV === "production" ? "live" : "test");

/** A key can't mint or revoke keys: a leaked key must not be able to extend or end its own life. */
function refuseKeyManagementViaKey(ctx: WorkspaceContext): void {
  if (ctx.viaApiKey)
    throw new AppError("FORBIDDEN", "API keys can't create or revoke API keys; sign in to do that");
}

/**
 * The expiry to store. The table refuses a date outside (created_at, created_at + 366 days] with a
 * raw 23514, which the error layer would show as an opaque 500, so the same window is checked here
 * and reported as a VALIDATION_ERROR naming the field.
 */
function resolveExpiry(requested: string | undefined, createdAt: Date): string {
  if (requested === undefined)
    return new Date(createdAt.getTime() + DEFAULT_EXPIRY_DAYS * DAY_MS).toISOString();
  const at = new Date(requested);
  const latest = new Date(createdAt.getTime() + MAX_EXPIRY_DAYS * DAY_MS);
  const invalid = (message: string) =>
    new AppError("VALIDATION_ERROR", message, [{ path: "expiresAt", message }]);
  if (at.getTime() <= createdAt.getTime()) throw invalid("The expiry must be in the future");
  if (at.getTime() > latest.getTime())
    throw invalid(
      `A key can last at most ${MAX_EXPIRY_DAYS} days; the latest expiry is ${latest.toISOString()}`,
    );
  return at.toISOString();
}

/**
 * Mints a key for the caller. Any member may; its effective role is capped by their own, so a
 * `write` key never does more than they could. The plaintext comes back here and nowhere else.
 */
export async function createApiKey(
  ctx: WorkspaceContext,
  input: unknown,
): Promise<{ key: ApiKey; plaintext: string }> {
  refuseKeyManagementViaKey(ctx);
  const { name, scope, expiresAt } = parseOrThrow(ApiKeyCreate, input);
  const createdAt = new Date();
  const expires = resolveExpiry(expiresAt, createdAt);

  // 40 random bits make a prefix clash vanishingly rare, but the column is unique: try again on one.
  for (let attempt = 1; ; attempt++) {
    const minted = mintApiKey(keyEnv());
    const row: NewApiKey = {
      id: newId(),
      workspaceId: ctx.workspace.id,
      userId: ctx.session.userId,
      name,
      prefix: minted.prefix,
      scope,
      createdAt: createdAt.toISOString(),
      lastUsedAt: null,
      expiresAt: expires,
      revokedAt: null,
      secretHash: minted.hash,
    };
    try {
      // The key and its audit entry are saved together or not at all.
      const key = await unitOfWork(ctx, async (ctx) => {
        const saved = await apiKeyRepository.insert(ctx, row);
        await recordAudit(ctx, {
          entityType: "api_key",
          entityId: saved.id,
          action: "api_key.created",
          // Names and limits only: never the plaintext, never the hash.
          diff: {
            name: { from: null, to: saved.name },
            prefix: { from: null, to: saved.prefix },
            scope: { from: null, to: saved.scope },
            expiresAt: { from: null, to: saved.expiresAt },
          },
        });
        return saved;
      });
      return { key, plaintext: minted.plaintext };
    } catch (err) {
      const clash = err instanceof AppError && err.code === "CONFLICT";
      if (!clash || attempt >= 3) throw err;
    }
  }
}

/** The caller's own keys; owners and admins also see everyone else's in the workspace. */
export async function listApiKeys(ctx: WorkspaceContext): Promise<ApiKey[]> {
  return ctx.role === "owner" || ctx.role === "admin"
    ? apiKeyRepository.listForWorkspace(ctx)
    : apiKeyRepository.listForUser(ctx, ctx.session.userId);
}

/**
 * Revokes a key. Members revoke their own; owners and admins revoke any in the workspace (the
 * repository's access rules decide: a key the caller can't see is NOT_FOUND). Revoking a revoked key
 * is a no-op: it returns the key as it is and writes no second audit entry.
 */
export async function revokeApiKey(ctx: WorkspaceContext, id: string): Promise<ApiKey> {
  refuseKeyManagementViaKey(ctx);
  const at = nowIso();
  return unitOfWork(ctx, async (ctx) => {
    // Already revoked: hand it back untouched, no write and no second audit entry. A key the caller
    // can't see isn't found here, so it falls through to `revoke`, which answers NOT_FOUND.
    const existing = (await listApiKeys(ctx)).find((k) => k.id === id);
    if (existing?.revokedAt) return existing;
    const key = await apiKeyRepository.revoke(ctx, id, at);
    // Two revokes racing: the loser gets the winner's row back, which carries the winner's timestamp.
    if (key.revokedAt === at)
      await recordAudit(ctx, {
        entityType: "api_key",
        entityId: key.id,
        action: "api_key.revoked",
        diff: { revokedAt: { from: null, to: at }, prefix: { from: null, to: key.prefix } },
      });
    return key;
  });
}

/** The one failure the caller ever sees: it never says which step failed. */
const invalidKey = () => new AppError("UNAUTHORIZED", "Invalid API key");

/** Burns the same comparison a real key would, so an unknown prefix isn't faster than a wrong secret. */
const NO_HASH = "0".repeat(64);

/**
 * Authenticates an `Authorization` header as an API key and returns the context it acts in (ADR-036).
 *
 * Every failure is the same UNAUTHORIZED with the same message; the reason goes to the log only, with
 * the key's prefix and never anything secret. Steps, in order:
 *   1. the header parses as a key; 2. a key with that prefix exists; 3. the secret matches its hash
 *   (constant time); 4. its issuer's membership is read (as that member, so RLS applies), *before*
 *   the next checks, so that revoked, expired and removed cost the same and latency can't tell a
 *   holder of the secret which it was; 5. it isn't revoked or expired; 6. the issuer is still a
 *   member (removing them kills the key); 7. `last_used_at` is touched, a failure there is logged
 *   and ignored, and it happens before step 8 so a refused use still leaves a trace; 8. a `read`
 *   key on a mutating request is refused (403: the caller has proven the whole key by now, so this
 *   reveals nothing); 9. the context is built with the lower of the scope's and the member's role
 *   and `viaApiKey` set.
 *
 * Never calls `ensureWorkspace`: that would create a workspace for a user who has none.
 */
export async function contextForApiKey(
  header: string | null | undefined,
  opts: { mutating?: boolean } = {},
): Promise<WorkspaceContext> {
  const parsed = parseApiKey(header);
  if (!parsed) {
    logger.info("API key rejected", { reason: "malformed" });
    throw invalidKey();
  }
  const reject = (reason: string) => {
    logger.info("API key rejected", { reason, prefix: parsed.prefix });
    return invalidKey();
  };

  const row = await apiKeyRepository.findByPrefix(parsed.prefix);
  if (!row) {
    secretMatches(parsed.secret, NO_HASH);
    throw reject("unknown prefix");
  }
  if (!secretMatches(parsed.secret, row.secretHash)) throw reject("secret mismatch");
  const now = new Date();

  // The key acts as its issuer. Name the session after the prefix, the log-correlation handle.
  const session: Session = { userId: row.userId, name: `API key ${row.prefix}`, email: "" };
  const found = await unitOfWork({ session }, async (scope) => {
    const memberships = await workspaceRepository.membershipsForUser(scope, row.userId);
    const member = memberships.find((m) => m.workspaceId === row.workspaceId);
    if (!member) return null;
    const workspace = await workspaceRepository.findById(scope, row.workspaceId);
    return workspace ? { member, workspace } : null;
  });
  if (row.revokedAt) throw reject("revoked");
  if (new Date(row.expiresAt).getTime() <= now.getTime()) throw reject("expired");
  if (!found) throw reject("not a member");

  try {
    await apiKeyRepository.touchLastUsed(row.id, now.toISOString());
  } catch (err) {
    logger.warn("Couldn't record API key use", {
      prefix: row.prefix,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (opts.mutating && row.scope === "read") {
    logger.info("API key refused", { reason: "read-only key on a write", prefix: row.prefix });
    throw new AppError("FORBIDDEN", "This API key is read-only");
  }

  return {
    session,
    workspace: found.workspace,
    role: effectiveRole(row.scope, found.member.role),
    viaApiKey: true,
  };
}
