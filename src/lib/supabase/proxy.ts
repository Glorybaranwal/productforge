import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { isApiKeyHeader } from "@/src/lib/api-key";
import {
  BUCKET_HEADER,
  gate,
  isCrossSiteWrite,
  rateBucket,
  requestSurface,
  SURFACE_HEADER,
} from "@/src/lib/auth-gate";
import type { ApiErrorBody } from "@/src/lib/errors";

import { authCookieOptions, authDriver, supabaseConfig } from "./config";

/** Sign-in attempts per client IP per minute (PF-084). */
const SIGN_IN_PER_MIN = 20;
const SIGN_IN_WINDOW_MS = 60_000;
/** Hard ceiling on tracked IPs so a flood of distinct addresses cannot grow this map without bound. */
const MAX_TRACKED_IPS = 10_000;
const signInHits = new Map<string, { windowStart: number; hits: number }>();

/**
 * The client's address as the platform reports it, or null. Vercel sets `x-real-ip` and overwrites
 * `x-forwarded-for` (client first), so on Vercel neither can be forged by the caller. Null when
 * neither is present: the caller then meters NOTHING, never a shared "unknown" bucket, because one
 * missing header must not lock out every visitor at once.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * Is this a sign-in request worth counting? `/auth/*` (callback, sign-out) always; `/login` only when
 * it is a form post (the sign-in server actions). Viewing the page is a render and is never metered.
 */
export function isSignInAttempt(pathname: string, method: string): boolean {
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  return (
    (pathname === "/login" || pathname.startsWith("/login/")) && method.toUpperCase() === "POST"
  );
}

/**
 * Per-IP speed bump in front of Supabase's own sign-in limit (PF-084, ADR-037); not the real control.
 * Middleware may do no database work, so this counts in memory: PER INSTANCE and therefore
 * approximate (N instances allow up to N times the limit, and a cold start forgets). Returns the
 * seconds to wait when the IP is over the limit, else null. A missing IP is never limited.
 */
export function signInRetryAfter(ip: string | null, now = Date.now()): number | null {
  if (!ip) return null;
  const entry = signInHits.get(ip);
  if (!entry || now - entry.windowStart >= SIGN_IN_WINDOW_MS) {
    if (signInHits.size >= MAX_TRACKED_IPS) {
      for (const [key, e] of signInHits)
        if (now - e.windowStart >= SIGN_IN_WINDOW_MS) signInHits.delete(key);
      // Still full of live windows: stop tracking new addresses rather than grow, i.e. fail open.
      if (signInHits.size >= MAX_TRACKED_IPS) return null;
    }
    signInHits.set(ip, { windowStart: now, hits: 1 });
    return null;
  }
  entry.hits += 1;
  if (entry.hits <= SIGN_IN_PER_MIN) return null;
  return Math.max(1, Math.ceil((entry.windowStart + SIGN_IN_WINDOW_MS - now) / 1000));
}

/** Test hook: forget every counted address. */
export function resetSignInGuard(): void {
  signInHits.clear();
}

/**
 * Runs before every request (PF-013, ADR-021, ADR-023): refuses cross-site writes, refreshes the
 * Supabase session cookie, then applies the `gate` rules (an API key opens `/api` only). Follows Supabase's Next.js guide — see the comments before changing the order.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Tell the app what kind of request this is (PF-083). Always overwritten, so a value the client
  // sent can never reach `currentContext`; it is what keeps API keys off `/dashboard`.
  const surface = requestSurface(request.nextUrl.pathname, request.method);
  request.headers.set(SURFACE_HEADER, surface);
  // The rate-limit class (PF-084), stamped the same way and for the same reason. When the request is
  // not metered the header is REMOVED, not left alone: a client that sends `x-pf-bucket: read` on an
  // upload must not get the 240/min class.
  const bucket = rateBucket(request.nextUrl.pathname, request.method);
  if (bucket) request.headers.set(BUCKET_HEADER, bucket);
  else request.headers.delete(BUCKET_HEADER);
  if (isSignInAttempt(request.nextUrl.pathname, request.method)) {
    const wait = signInRetryAfter(clientIp(request.headers));
    if (wait !== null) {
      // Answered here, so unlike a server-action throw it carries Retry-After.
      const body: ApiErrorBody = {
        error: {
          code: "RATE_LIMITED",
          message: "Too many sign-in attempts. Wait a moment and try again.",
        },
      };
      return NextResponse.json(body, { status: 429, headers: { "Retry-After": String(wait) } });
    }
  }
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
