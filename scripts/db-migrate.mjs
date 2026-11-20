// `pnpm db:migrate` — apply pending migrations from src/db/migrations (ADR-005).
// Uses drizzle-orm's migrator, which keeps the same `drizzle.__drizzle_migrations` table as
// `drizzle-kit migrate`, because drizzle-kit exits with code 1 without printing the database's error.
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { sslFor } from "../src/db/ssl.mjs";

import { describeDbError, pendingMigrations } from "./lib/migrate.mjs";

const FOLDER = "src/db/migrations";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment (CI).
}

const url = process.env.DATABASE_DIRECT_URL;
if (!url) {
  console.error("DATABASE_DIRECT_URL isn't set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

let host = "the database";
try {
  host = new URL(url).host;
} catch {
  // Keep the generic name; never print the URL itself (it holds the password).
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  ssl: sslFor(url),
  onnotice: () => {},
});
let exitCode = 0;
try {
  const journal = JSON.parse(readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"));
  const pending = pendingMigrations(journal, await lastApplied());
  if (!pending.length) {
    console.log(`✓ ${host}: up to date (${journal.entries.length} migrations)`);
  } else {
    console.log(`Applying to ${host}: ${pending.join(", ")}`);
    await migrate(drizzle(sql), { migrationsFolder: FOLDER });
    console.log(`✓ Applied ${pending.length} migration(s)`);
  }
} catch (err) {
  console.error(
    `✗ Migration failed on ${host}. It runs in one transaction, so nothing was changed.`,
  );
  console.error(describeDbError(err));
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(exitCode);

async function lastApplied() {
  try {
    const [row] =
      await sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
    return row ? Number(row.created_at) : 0;
  } catch (err) {
    if (err?.code === "42P01" || err?.code === "3F000") return 0; // no table or schema yet
    throw err;
  }
}
