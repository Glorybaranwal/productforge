import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import { contentSecurityPolicy, newNonce } from "@/src/lib/csp";

const prod = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };
const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src"))!;

afterEach(() => vi.unstubAllEnvs());

describe("Content Security Policy (PF-019)", () => {
  it("allows only nonce-bearing scripts in production: no inline, no eval", () => {
    const csp = contentSecurityPolicy({ nonce: "abc123", env: prod });
    expect(scriptSrc(csp)).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self' https://example.supabase.co https://github.com");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("adds only what the dev server needs in development", () => {
    const csp = contentSecurityPolicy({ nonce: "abc123", env: { NODE_ENV: "development" } });
    expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("makes a new nonce for every request", () => {
    expect(newNonce()).not.toBe(newNonce());
  });

  it("sends the same nonce to the page renderer and to the browser", async () => {
    vi.stubEnv("AUTH_DRIVER", "demo");
    const response = await proxy(new NextRequest("http://localhost:3000/"));
    const csp = response.headers.get("content-security-policy")!;
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });
});
