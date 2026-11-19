import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_USER } from "@/src/lib/auth";
import { getSession, sessionFromClaims } from "@/src/lib/session";

const auth = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

const USER_ID = "3f1c2b9a-6d4e-4f8a-9b2c-1a2b3c4d5e6f";

afterEach(() => {
  vi.unstubAllEnvs();
  auth.getClaims.mockReset();
});

function supabaseMode() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

describe("sessionFromClaims (PF-013)", () => {
  it("names the user from their GitHub profile, else their email", () => {
    expect(
      sessionFromClaims({
        sub: USER_ID,
        email: "ana@example.com",
        user_metadata: { full_name: "Ana Lima", user_name: "ana" },
      }),
    ).toEqual({ userId: USER_ID, name: "Ana Lima", email: "ana@example.com" });
    expect(
      sessionFromClaims({ sub: USER_ID, email: "ben@example.com", user_metadata: { name: " " } }),
    ).toEqual({ userId: USER_ID, name: "ben", email: "ben@example.com" });
    expect(sessionFromClaims({ sub: USER_ID })).toEqual({
      userId: USER_ID,
      name: "Member",
      email: "",
    });
  });

  it("rejects claims that don't name a user", () => {
    expect(sessionFromClaims(null)).toBeNull();
    expect(sessionFromClaims({ email: "x@example.com" })).toBeNull();
    expect(sessionFromClaims({ sub: "not-a-uuid" })).toBeNull();
  });
});

describe("getSession (PF-013)", () => {
  it("is the demo user in demo mode, without touching Supabase", async () => {
    vi.stubEnv("AUTH_DRIVER", "demo");
    expect(await getSession()).toEqual(DEMO_USER);
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it("refuses demo mode in production", async () => {
    vi.stubEnv("AUTH_DRIVER", "demo");
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(getSession()).rejects.toThrow(/production/);
  });

  it("is the verified Supabase user, or null when the token doesn't verify", async () => {
    supabaseMode();
    auth.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: USER_ID, email: "ana@example.com" } },
      error: null,
    });
    expect(await getSession()).toEqual({ userId: USER_ID, name: "ana", email: "ana@example.com" });

    auth.getClaims.mockResolvedValueOnce({ data: null, error: null });
    expect(await getSession()).toBeNull();

    auth.getClaims.mockResolvedValueOnce({ data: null, error: new Error("invalid JWT") });
    expect(await getSession()).toBeNull();
  });
});
