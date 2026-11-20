import type { NextConfig } from "next";

/**
 * Security headers on every response (ADR-023). The Content Security Policy is per request, with a
 * nonce, so the proxy sets it (src/lib/csp.ts, PF-019).
 */
export function securityHeaders(env: Record<string, string | undefined> = process.env) {
  const dev = env.NODE_ENV !== "production";
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(dev
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // System prompts are read from disk at runtime (src/ai/prompts/load.ts): ship them with the API routes.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/ai/prompts/**/*.md"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // Signed-in data must never sit in a shared or browser cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
