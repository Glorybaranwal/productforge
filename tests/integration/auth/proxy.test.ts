/**
 * The sign-in gate as Next.js runs it (PF-013): `updateSession` with Supabase's SSR client replaced
 * by a fake that verifies (or doesn't) and may refresh the session cookie.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRequire } from "node:module";

import { config } from "@/proxy";
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

// Next compiles the matcher with its own bundled path-to-regexp, which ships no types.
const nodeRequire = createRequire(import.meta.url);
const { pathToRegexp } = nodeRequire("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (pattern: string) => RegExp;
};

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

  describe("API keys (PF-083)", () => {
    const KEY = `Bearer pf_live_abcdefgh_${"A".repeat(43)}`;
    const keyed = (
      path: string,
      init: { method?: string; headers?: Record<string, string> } = {},
    ) =>
      new NextRequest(new URL(path, "http://localhost:3000"), {
        ...init,
        headers: { authorization: KEY, ...init.headers },
      });

    it("lets a request to /api through on a key alone, with no session and no lookup", async () => {
      const res = await updateSession(keyed("/api/projects"));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("never lets a key open a dashboard page", async () => {
      for (const path of ["/dashboard", "/dashboard/projects/p1/prd"]) {
        const res = await updateSession(keyed(path));
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toContain("/login?next=");
      }
    });

    it("still answers 401 to /api with another kind of bearer token or a lookalike header", async () => {
      for (const authorization of [
        "Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc",
        "Basic abc",
        "pf_live_x",
      ]) {
        const res = await updateSession(
          new NextRequest(new URL("/api/projects", "http://localhost:3000"), {
            headers: { authorization },
          }),
        );
        expect(res.status).toBe(401);
      }
    });

    it("stamps every request with its surface, overwriting anything the client sent", async () => {
      const surfaceOf = async (path: string, method: string, sent?: string) => {
        const req = keyed(path, { method, headers: sent ? { "x-pf-surface": sent } : {} });
        fake.signedIn = true; // so a /dashboard request gets past the gate and is forwarded
        await updateSession(req);
        return req.headers.get("x-pf-surface");
      };
      expect(await surfaceOf("/api/projects", "GET")).toBe("api-read");
      expect(await surfaceOf("/api/projects", "POST")).toBe("api-write");
      expect(await surfaceOf("/api/projects/p1", "DELETE")).toBe("api-write");
      expect(await surfaceOf("/dashboard", "GET")).toBe("page");
      // A client claiming a different surface is overwritten, not believed.
      expect(await surfaceOf("/dashboard", "GET", "api-write")).toBe("page");
      expect(await surfaceOf("/api/projects", "GET", "page")).toBe("api-read");
      expect(await surfaceOf("/api/projects", "DELETE", "api-read")).toBe("api-write");
    });

    it("runs on /api and /dashboard whatever the last segment looks like, so the surface header is never the client's", () => {
      const runs = (path: string) => config.matcher.some((m) => pathToRegexp(m).test(path));
      // These end like a static image, so the first matcher entry skips them; the others must not.
      for (const path of [
        "/dashboard/projects/abc.png",
        "/dashboard/x/y.ico",
        "/api/projects/abc.png",
        "/api/workspace/api-keys/abc.svg",
        "/api/prds/x.jpeg",
        "/dashboard",
        "/api/projects",
      ])
        expect(runs(path), path).toBe(true);
      // Real static assets are still skipped.
      for (const path of [
        "/logo.png",
        "/favicon.ico",
        "/_next/static/chunk.js",
        "/images/hero.webp",
      ])
        expect(runs(path), path).toBe(false);
    });

    it("does not let a key plus a forged surface header open a dashboard path that ends in .png", async () => {
      const forged = keyed("/dashboard/projects/abc.png", {
        headers: { "x-pf-surface": "api-read" },
      });
      const res = await updateSession(forged);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?next=");
      // And signed in, the surface is still the proxy's, never the client's.
      fake.signedIn = true;
      const signedIn = keyed("/dashboard/projects/abc.png", {
        headers: { "x-pf-surface": "api-write" },
      });
      await updateSession(signedIn);
      expect(signedIn.headers.get("x-pf-surface")).toBe("page");
    });
  });
});
