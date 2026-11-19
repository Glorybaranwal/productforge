import { type NextRequest, NextResponse } from "next/server";

import { signOut } from "@/src/lib/supabase/sign-in";

/** POST /auth/signout — ends the session on this device, then shows the sign-in page (PF-013). */
export async function POST(request: NextRequest) {
  await signOut();
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
