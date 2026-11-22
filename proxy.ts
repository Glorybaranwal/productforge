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
  // Everything except static assets and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
