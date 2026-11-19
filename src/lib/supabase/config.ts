/**
 * Which sign-in the app uses and where Supabase lives (PF-013, ADR-021). Each function reads the
 * env it's given (default `process.env`), so the rules are unit-tested without touching globals.
 */
export type AuthDriver = "supabase" | "demo";
export type OAuthProvider = "github";

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" ? process.env : {});

/**
 * `AUTH_DRIVER` when set; otherwise Supabase whenever its URL and publishable key are configured,
 * and demo mode (ADR-011: one local user, no sign-in) when they aren't.
 */
export function authDriver(env: Env = processEnv()): AuthDriver {
  const explicit = env.AUTH_DRIVER?.trim();
  if (explicit === "supabase" || explicit === "demo") return explicit;
  if (explicit) throw new Error(`AUTH_DRIVER must be "supabase" or "demo", not "${explicit}"`);
  return env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ? "supabase"
    : "demo";
}

export function supabaseConfig(env: Env = processEnv()): { url: string; publishableKey: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase sign-in needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)",
    );
  }
  return { url, publishableKey };
}

/**
 * Where sign-in links send the browser back to. Must be allowed in Supabase → Authentication →
 * URL Configuration (Site URL / Redirect URLs).
 */
export function appUrl(env: Env = processEnv()): string {
  return (env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Session cookie settings. `httpOnly`: no script in the page can read the session (sign-in runs on
 * the server; there's no browser Supabase client). `secure` whenever the app is served over HTTPS.
 */
export function authCookieOptions(env: Env = processEnv()) {
  return {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    secure: appUrl(env).startsWith("https://"),
  };
}

/** OAuth buttons to offer, e.g. `AUTH_OAUTH_PROVIDERS=github`. Email links are always on. */
export function oauthProviders(env: Env = processEnv()): OAuthProvider[] {
  return (env.AUTH_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is OAuthProvider => p === "github");
}
