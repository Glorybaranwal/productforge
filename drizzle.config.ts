import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env.local on its own (Node ≥ 20.12).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: use the environment as it is (CI).
}

/**
 * `pnpm db:generate` writes SQL migrations from src/db/schema; `pnpm db:migrate` applies them.
 * Migrations use the session pooler or a direct connection (ADR-005), never the transaction pooler.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: withSsl(process.env.DATABASE_DIRECT_URL ?? "") },
  // Supabase's own roles (anon, authenticated, service_role…) exist already; never create or drop them.
  entities: { roles: { provider: "supabase" } },
  strict: true,
  verbose: true,
});

/**
 * drizzle-kit only takes a URL, so encryption goes in as `sslmode` for remote hosts (ADR-023). Same
 * rule as src/db/ssl.mjs, repeated here because drizzle-kit loads this file as CommonJS.
 */
function withSsl(url: string): string {
  try {
    const { hostname, searchParams } = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (local || searchParams.has("sslmode") || searchParams.has("ssl")) return url;
  } catch {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}
