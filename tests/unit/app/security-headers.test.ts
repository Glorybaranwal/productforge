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
    // The CSP is per request, with a nonce: the proxy sets it (tests/unit/lib/csp.test.ts).
    expect(header(headers, "Content-Security-Policy")).toBeUndefined();
    expect(header(headers, "X-Frame-Options")).toBe("DENY");
    expect(header(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(headers, "Strict-Transport-Security")).toContain("max-age=");
  });

  it("leaves HSTS off in development", () => {
    const headers = securityHeaders({ NODE_ENV: "development" });
    expect(header(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("applies them to every path and keeps API responses out of caches", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.find((r) => r.source === "/:path*")?.headers.length).toBeGreaterThan(4);
    expect(rules.find((r) => r.source === "/api/:path*")?.headers).toEqual([
      { key: "Cache-Control", value: "private, no-store" },
    ]);
  });
});
