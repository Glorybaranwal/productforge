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
  dbCredentials: { url: process.env.DATABASE_DIRECT_URL ?? "" },
  // Supabase's own roles (anon, authenticated, service_role…) exist already; never create or drop them.
  entities: { roles: { provider: "supabase" } },
  strict: true,
  verbose: true,
});
