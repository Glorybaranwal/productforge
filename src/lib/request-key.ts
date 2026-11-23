/**
 * The API key on the current request, if it may be used here (PF-083, ADR-036). Server only: it reads
 * the request's headers through `next/headers`, so `currentContext` imports it lazily, like
 * `getSession`, to keep scripts (`pnpm db:seed`) from loading it.
 */
import { headers } from "next/headers";

import { isApiKeyHeader } from "./api-key";
import { SURFACE_HEADER } from "./auth-gate";

/**
 * The `Authorization` header and whether the request can change state, or null when there is no key
 * or this isn't an API request. Keys are honoured on `/api` only: `proxy.ts` sets the surface header
 * on every request (overwriting anything the client sent), so a key on a `/dashboard` page is
 * ignored and the normal sign-in applies.
 */
export async function apiKeyFromRequest(): Promise<{ header: string; mutating: boolean } | null> {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch (err) {
    // Next signals "render dynamically" and similar through errors that carry a `digest`: pass those on.
    if (
      typeof err === "object" &&
      err !== null &&
      typeof (err as { digest?: unknown }).digest === "string"
    )
      throw err;
    return null; // Outside a request (a script, a unit test): there is no key to read.
  }
  const header = requestHeaders.get("authorization");
  if (!header || !isApiKeyHeader(header)) return null;
  const surface = requestHeaders.get(SURFACE_HEADER);
  if (surface !== "api-read" && surface !== "api-write") return null;
  return { header, mutating: surface === "api-write" };
}
