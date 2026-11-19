import { type NextRequest, NextResponse } from "next/server";

import { completeSignIn } from "@/src/lib/supabase/sign-in";

/** GET /auth/callback — magic links and GitHub land here; sets the session cookie (PF-013). */
export async function GET(request: NextRequest) {
  const result = await completeSignIn(request.nextUrl.searchParams);
  const target = result.ok ? result.next : `/login?error=${result.reason}`;
  return NextResponse.redirect(new URL(target, request.url));
}
