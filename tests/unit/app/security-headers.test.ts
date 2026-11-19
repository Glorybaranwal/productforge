import { describe, expect, it } from "vitest";

import nextConfig, { securityHeaders } from "@/next.config";

const header = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key === key)?.value;

describe("security headers (ADR-023)", () => {
  it("locks down framing, sniffing, referrers and third-party origins in production", () => {
    const headers = securityHeaders({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    const csp = header(headers, "Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self' https://example.supabase.co https://github.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(header(headers, "X-Frame-Options")).toBe("DENY");
    expect(header(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(headers, "Strict-Transport-Security")).toContain("max-age=");
  });

  it("allows only what the dev server needs in development", () => {
    const headers = securityHeaders({ NODE_ENV: "development" });
    expect(header(headers, "Content-Security-Policy")).toContain("'unsafe-eval'");
    expect(header(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("applies them to every path and keeps API responses out of caches", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.find((r) => r.source === "/:path*")?.headers.length).toBeGreaterThan(5);
    expect(rules.find((r) => r.source === "/api/:path*")?.headers).toEqual([
      { key: "Cache-Control", value: "private, no-store" },
    ]);
  });
});
