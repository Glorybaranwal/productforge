import { describe, expect, it } from "vitest";

import { appUrl, authDriver, oauthProviders, supabaseConfig } from "@/src/lib/supabase/config";

const SUPABASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

describe("auth config (PF-013)", () => {
  it("uses Supabase sign-in once Supabase is configured, demo mode otherwise", () => {
    expect(authDriver({})).toBe("demo");
    expect(authDriver({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL })).toBe(
      "demo",
    );
    expect(authDriver(SUPABASE)).toBe("supabase");
  });

  it("lets AUTH_DRIVER override, and rejects unknown values", () => {
    expect(authDriver({ ...SUPABASE, AUTH_DRIVER: "demo" })).toBe("demo");
    expect(authDriver({ AUTH_DRIVER: "supabase" })).toBe("supabase");
    expect(() => authDriver({ AUTH_DRIVER: "none" })).toThrow(/AUTH_DRIVER/);
  });

  it("explains which variables are missing", () => {
    expect(supabaseConfig(SUPABASE)).toEqual({
      url: SUPABASE.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: SUPABASE.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    expect(() => supabaseConfig({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("builds sign-in links from APP_URL", () => {
    expect(appUrl({})).toBe("http://localhost:3000");
    expect(appUrl({ APP_URL: "https://productforge.example/ " })).toBe(
      "https://productforge.example",
    );
  });

  it("offers only known OAuth providers", () => {
    expect(oauthProviders({})).toEqual([]);
    expect(oauthProviders({ AUTH_OAUTH_PROVIDERS: " github , twitter" })).toEqual(["github"]);
  });
});
