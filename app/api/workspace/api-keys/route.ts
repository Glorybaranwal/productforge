import { readJson, withErrors } from "@/src/lib/http";
import { createApiKey, listApiKeys } from "@/src/modules/api-keys/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** Never cache a response that lists keys, least of all the one that carries a plaintext key. */
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/workspace/api-keys — your keys; owners and admins also see the workspace's. Never the secret. */
export const GET = withErrors(async () => {
  const ctx = await currentContext();
  return Response.json({ keys: await listApiKeys(ctx) }, { headers: NO_STORE });
});

/**
 * POST /api/workspace/api-keys — `{ name, scope: "read" | "write", expiresAt? }` (90 days by default,
 * 366 at most). 201 with `{ key, plaintext }`: the only response that ever carries the plaintext key.
 */
export const POST = withErrors(async (request: Request) => {
  const ctx = await currentContext();
  const created = await createApiKey(ctx, await readJson(request));
  return Response.json(created, { status: 201, headers: NO_STORE });
});
