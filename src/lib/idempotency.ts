import { nowIso } from "./ids";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

/** Reads the `Idempotency-Key` header (CLAUDE.md §8). Keys are opaque, up to 200 characters. */
export function idempotencyKeyFrom(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim();
  return key ? key.slice(0, 200) : null;
}

/**
 * Runs `work` once per (workspace, scope, key). A repeated request with the same key returns the
 * first result instead of starting a second run. Without a key, `work` always runs.
 */
export async function withIdempotency<T extends { id: string }>(
  ctx: WorkspaceContext,
  scope: string,
  key: string | null,
  work: () => Promise<T>,
  load: (id: string) => Promise<T | null>,
): Promise<{ result: T; replayed: boolean }> {
  if (key) {
    const existing = await agentRunRepository.findIdempotent(ctx, scope, key);
    const previous = existing && (await load(existing.resultId));
    if (previous) return { result: previous, replayed: true };
  }
  const result = await work();
  if (key) {
    await agentRunRepository.saveIdempotent(ctx, {
      workspaceId: ctx.workspace.id,
      scope,
      key,
      resultId: result.id,
      createdAt: nowIso(),
    });
  }
  return { result, replayed: false };
}
