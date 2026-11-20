// TLS for database connections (ADR-023). Shared by the app (src/db/client.ts) and the db:* scripts.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The postgres.js `ssl` option for a connection string: encrypted (`require`) for any remote host,
 * off for a database on this machine (local Supabase, PF-010). An `sslmode`/`ssl` parameter in the
 * URL itself wins, so `undefined` is returned and postgres.js reads it from there.
 */
export function sslFor(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "require";
  }
  if (parsed.searchParams.has("sslmode") || parsed.searchParams.has("ssl")) return undefined;
  return LOCAL_HOSTS.has(parsed.hostname) ? false : "require";
}
