/**
 * The signed-in user (PF-013, ADR-021). Server-only: it reads the request's cookies. Shared role and
 * session types stay in `auth.ts`, which client code may import.
 */
import { cache } from "react";
import { z } from "zod";

import { DEMO_USER, type Session } from "./auth";
import { authDriver } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";

const Claims = z.object({
  sub: z.uuid(),
  email: z.string().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

/** The app's session from verified Supabase JWT claims; null if they don't name a user. */
export function sessionFromClaims(claims: unknown): Session | null {
  const parsed = Claims.safeParse(claims);
  if (!parsed.success) return null;
  const { sub, email = "", user_metadata: meta = {} } = parsed.data;
  const text = (key: string) => {
    const value = meta[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  // GitHub fills full_name / name / user_name; magic-link users have only an email.
  const name =
    text("full_name") ?? text("name") ?? text("user_name") ?? (email.split("@")[0] || "Member");
  return { userId: sub, name, email };
}

/**
 * The signed-in user, or null (PF-013, ADR-021). Supabase mode verifies the token's signature with
 * `getClaims()` — never trust `getSession()` on the server. Cached for the length of a request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (authDriver() === "demo") {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("Demo mode can't serve production (ADR-011): configure Supabase sign-in");
    }
    return DEMO_USER;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;
  return sessionFromClaims(data.claims);
});
