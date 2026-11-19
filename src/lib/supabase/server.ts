import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { authCookieOptions, supabaseConfig } from "./config";

/**
 * A Supabase client bound to this request's auth cookies (PF-013). Create one per request. Server
 * Components can't write cookies; `proxy.ts` refreshes the session before they run.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseConfig();
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which can't write cookies; proxy.ts refreshes sessions.
        }
      },
    },
  });
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
