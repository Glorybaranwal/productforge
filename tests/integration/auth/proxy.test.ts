/**
 * The sign-in gate as Next.js runs it (PF-013): `updateSession` with Supabase's SSR client replaced
 * by a fake that verifies (or doesn't) and may refresh the session cookie.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@/src/lib/supabase/proxy";

type Cookie = { name: string; value: string };
type SetAll = (cookies: (Cookie & { options: object })[], headers: Record<string, string>) => void;

const fake = vi.hoisted(() => ({
  signedIn: false,
  /** Cookies Supabase writes during getClaims() — a refreshed or cleared session. */
  writes: [] as { name: string; value: string }[],
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: fake.createServerClient.mockImplementation(
    (_url: string, _key: string, options: { cookies: { setAll: SetAll } }) => ({
      auth: {
        getClaims: async () => {
          if (fake.writes.length)
            options.cookies.setAll(
              fake.writes.map((c) => ({ ...c, options: { path: "/", httpOnly: true } })),
              { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
            );
          return fake.signedIn
            ? { data: { claims: { sub: "3f1c2b9a-6d4e-4f8a-9b2c-1a2b3c4d5e6f" } }, error: null }
            : { data: null, error: null };
        },
      },
    }),
  ),
}));

const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  fake.signedIn = false;
  fake.writes = [];
  fake.createServerClient.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("proxy (PF-013)", () => {
  it("redirects signed-out visitors from the dashboard to sign-in, then back", async () => {
    const res = await updateSession(request("/dashboard/projects/p1/prd?tab=items"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard%2Fprojects%2Fp1%2Fprd%3Ftab%3Ditems",
    );
  });

  it("answers signed-out API calls with a 401 error body", async () => {
    const res = await updateSession(request("/api/projects"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Please sign in" },
    });
  });

  it("lets signed-in users through and keeps the refreshed session cookie", async () => {
    fake.signedIn = true;
    fake.writes = [{ name: "sb-example-auth-token", value: "refreshed" }];
    const res = await updateSession(request("/dashboard"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.cookies.get("sb-example-auth-token")?.value).toBe("refreshed");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("carries a cleared session cookie onto the redirect", async () => {
    fake.writes = [{ name: "sb-example-auth-token", value: "" }];
    const res = await updateSession(request("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.cookies.get("sb-example-auth-token")?.value).toBe("");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("forwards signed-in users from the sign-in page to where they were going", async () => {
    fake.signedIn = true;
    const res = await updateSession(request("/login?next=%2Fdashboard%2Fprojects%2Fp1"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects/p1");
  });

  it("leaves public pages open", async () => {
    for (const path of ["/", "/login", "/auth/callback?code=x"]) {
      const res = await updateSession(request(path));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("refuses cross-site writes before anything else, even in demo mode", async () => {
    vi.stubEnv("AUTH_DRIVER", "demo");
    const res = await updateSession(
      new NextRequest("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("keeps the session cookie out of reach of page scripts", async () => {
    await updateSession(request("/dashboard"));
    expect(fake.createServerClient.mock.calls[0]![2]).toMatchObject({
      cookieOptions: { httpOnly: true, sameSite: "lax" },
    });
  });

  it("does nothing in demo mode", async () => {
    vi.stubEnv("AUTH_DRIVER", "demo");
    const res = await updateSession(request("/dashboard"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(fake.createServerClient).not.toHaveBeenCalled();
  });
});
