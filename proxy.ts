import type { NextRequest } from "next/server";

import { contentSecurityPolicy, newNonce } from "@/src/lib/csp";
import { updateSession } from "@/src/lib/supabase/proxy";

/**
 * Next.js 16 Proxy (formerly Middleware): a fresh CSP nonce (PF-019), then session refresh + sign-in
 * gate (PF-013, ADR-021).
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy({ nonce });
  // Next.js takes the nonce from the request's CSP header when it renders the page.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images...
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    // ...but never skip the API or the dashboard, whatever their last segment looks like. A path such
    // as `/dashboard/projects/x.png` still routes to a page, and without the proxy `x-pf-surface` would
    // be whatever the client sent, which is what keeps API keys off `/dashboard` (PF-083). The proxy
    // also runs the sign-in gate and the cross-site write check, so these must not be skippable.
    "/api/:path*",
    "/dashboard/:path*",
  ],
};
