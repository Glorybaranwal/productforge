/**
 * Sign-in, sign-out and the session in route handlers (PF-013), with the Supabase server client
 * replaced by a fake. The data store is the in-memory demo store.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as callbackRoute from "@/app/auth/callback/route";
import * as signOutRoute from "@/app/auth/signout/route";
import { sendMagicLink, signInWithGitHub } from "@/app/login/actions";
import * as projectsRoute from "@/app/api/projects/route";
import { resetDb, validProject } from "@/tests/helpers/context";

const auth = vi.hoisted(() => ({
  getClaims: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

const ANA = "3f1c2b9a-6d4e-4f8a-9b2c-1a2b3c4d5e6f";
const OK = { data: {}, error: null };
const BAD_LINK = { data: {}, error: { status: 403, code: "otp_expired", message: "expired" } };

const get = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  resetDb();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  for (const fn of Object.values(auth)) fn.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("/auth/callback (PF-013)", () => {
  it("exchanges the code for a session and returns to where the user was going", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(OK);
    const res = await callbackRoute.GET(
      get("/auth/callback?code=abc&next=%2Fdashboard%2Fprojects%2Fp1"),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard/projects/p1");
  });

  it("accepts a token_hash link from a custom email template", async () => {
    auth.verifyOtp.mockResolvedValue(OK);
    const res = await callbackRoute.GET(get("/auth/callback?token_hash=th&type=email"));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "email" });
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("sends failures back to sign-in with a known reason", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(BAD_LINK);
    const expired = await callbackRoute.GET(get("/auth/callback?code=old"));
    expect(expired.headers.get("location")).toBe("http://localhost:3000/login?error=link_invalid");

    const denied = await callbackRoute.GET(get("/auth/callback?error=access_denied&code=x"));
    expect(denied.headers.get("location")).toBe(
      "http://localhost:3000/login?error=provider_denied",
    );
    const empty = await callbackRoute.GET(get("/auth/callback"));
    expect(empty.headers.get("location")).toBe("http://localhost:3000/login?error=missing_code");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("never redirects to another site", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(OK);
    const res = await callbackRoute.GET(get("/auth/callback?code=abc&next=%2F%2Fevil.example"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });
});

describe("sign-in actions (PF-013)", () => {
  it("emails a link that returns through /auth/callback", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const state = await sendMagicLink(
      { status: "idle" },
      form({ email: " ana@example.com ", next: "/dashboard/projects/p1" }),
    );
    expect(state).toEqual({ status: "sent", email: "ana@example.com" });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard%2Fprojects%2Fp1",
        shouldCreateUser: true,
      },
    });
  });

  it("explains a bad address or a rate limit without calling out details", async () => {
    expect(await sendMagicLink({ status: "idle" }, form({ email: "not-an-email" }))).toMatchObject({
      status: "error",
      message: "Enter a valid email address.",
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();

    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_email_send_rate_limit", message: "rate limit" },
    });
    expect(await sendMagicLink({ status: "idle" }, form({ email: "ana@example.com" }))).toEqual({
      status: "error",
      email: "ana@example.com",
      message: "Too many sign-in attempts. Wait a minute and try again.",
    });
  });

  it("starts GitHub sign-in only when it's enabled", async () => {
    await expect(signInWithGitHub(form({ next: "/dashboard" }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    vi.stubEnv("AUTH_OAUTH_PROVIDERS", "github");
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://github.com/login/oauth/authorize?client_id=x" },
      error: null,
    });
    await expect(signInWithGitHub(form({ next: "/dashboard" }))).rejects.toMatchObject({
      digest: expect.stringContaining("https://github.com/login/oauth/authorize?client_id=x"),
    });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard",
        skipBrowserRedirect: true,
      },
    });
  });
});

describe("session in route handlers (PF-013)", () => {
  it("gives handlers the verified user, with their own workspace", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { sub: ANA, email: "ana@example.com", user_metadata: { full_name: "Ana" } } },
      error: null,
    });
    const created = await projectsRoute.POST(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validProject),
      }),
    );
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { createdBy: string } };
    expect(project.createdBy).toBe(ANA);
  });

  it("answers 401 when there is no verified user", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    const res = await projectsRoute.GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("signs out on this device only and shows the sign-in page", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    const res = await signOutRoute.POST(
      new NextRequest("http://localhost:3000/auth/signout", { method: "POST" }),
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
