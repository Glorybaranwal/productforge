import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { isApiKeyHeader } from "@/src/lib/api-key";
import { gate, isCrossSiteWrite, requestSurface, SURFACE_HEADER } from "@/src/lib/auth-gate";
import type { ApiErrorBody } from "@/src/lib/errors";

import { authCookieOptions, authDriver, supabaseConfig } from "./config";

/**
 * Runs before every request (PF-013, ADR-021, ADR-023): refuses cross-site writes, refreshes the
 * Supabase session cookie, then applies the `gate` rules (an API key opens `/api` only). Follows Supabase's Next.js guide — see the comments before changing the order.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Tell the app what kind of request this is (PF-083). Always overwritten, so a value the client
  // sent can never reach `currentContext`; it is what keeps API keys off `/dashboard`.
  const surface = requestSurface(request.nextUrl.pathname, request.method);
  request.headers.set(SURFACE_HEADER, surface);
  const crossSite = isCrossSiteWrite({
    method: request.method,
    pathname: request.nextUrl.pathname,
    selfOrigin: request.nextUrl.origin,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
  if (crossSite) {
    const body: ApiErrorBody = {
      error: { code: "FORBIDDEN", message: "Cross-site request refused" },
    };
    return NextResponse.json(body, { status: 403 });
  }
  if (authDriver() === "demo") return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  let noCacheHeaders: Record<string, string> = {};
  const { url, publishableKey } = supabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        // Cache-Control etc.: a response that sets auth cookies must never be cached by a CDN.
        noCacheHeaders = headers;
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Nothing may run between creating the client and getClaims(): it verifies the token's signature
  // and refreshes an expiring one. Skipping it signs users out at random (Supabase's guidance).
  const { data } = await supabase.auth.getClaims();
  // An API request carrying a key passes without a cookie session. Middleware does no database work:
  // the route verifies the key (`contextForApiKey`) and answers 401 if it is bad.
  const keyed = surface !== "page" && isApiKeyHeader(request.headers.get("authorization"));
  const decision = gate(request.nextUrl, Boolean(data?.claims) || keyed);
  if (decision.kind === "next") return response;

  const body: ApiErrorBody = { error: { code: "UNAUTHORIZED", message: "Please sign in" } };
  const out =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : NextResponse.json(body, { status: 401 });
  // Carry refreshed or cleared session cookies over, or browser and server drift apart.
  for (const cookie of response.cookies.getAll()) out.cookies.set(cookie);
  for (const [key, value] of Object.entries(noCacheHeaders)) out.headers.set(key, value);
  return out;
}
