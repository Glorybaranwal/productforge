import type { NextRequest } from "next/server";

import { updateSession } from "@/src/lib/supabase/proxy";

/** Next.js 16 Proxy (formerly Middleware): session refresh + sign-in gate (PF-013, ADR-021). */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
