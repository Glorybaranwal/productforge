import type { NextConfig } from "next";

/**
 * Security headers on every response (ADR-023). The CSP allows inline scripts and styles because
 * Next.js injects them; a nonce-based CSP is a later hardening step. No third-party origins are
 * allowed except where a sign-in form may be redirected (Supabase Auth → GitHub).
 */
export function securityHeaders(env: Record<string, string | undefined> = process.env) {
  const dev = env.NODE_ENV !== "production";
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${supabase ? ` ${supabase}` : ""} https://github.com`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
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
