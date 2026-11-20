/**
 * Content Security Policy with a per-request nonce (PF-019, ADR-032). The proxy builds it for every
 * page request; Next.js reads the nonce from the request's CSP header and stamps it on its own
 * scripts, so no inline script runs without it. Styles keep 'unsafe-inline' for React style
 * attributes. Only a sign-in form may leave the site (Supabase Auth → GitHub).
 */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export function contentSecurityPolicy({
  nonce,
  env = process.env,
}: {
  nonce: string;
  env?: Record<string, string | undefined>;
}): string {
  const dev = env.NODE_ENV !== "production";
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  return [
    "default-src 'self'",
    // 'strict-dynamic': scripts loaded by a nonce-bearing script are trusted; nothing else is.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
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
}
