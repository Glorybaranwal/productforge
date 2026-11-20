// `pnpm db:audit` — data-isolation audit of the database in .env.local (ADR-023). Read-only: every
// probe runs in one transaction that is rolled back. Exits 1 if anything leaks.
import postgres from "postgres";

import { sslFor } from "../src/db/ssl.mjs";

import { auditDataIsolation } from "./lib/data-audit.mjs";

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

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  ssl: sslFor(url),
  onnotice: () => {},
});
const ROLLBACK = new Error("rollback");
let report;
try {
  await sql.begin(async (tx) => {
    report = await auditDataIsolation((text, params = []) => tx.unsafe(text, params));
    throw ROLLBACK;
  });
} catch (err) {
  if (err !== ROLLBACK) {
    console.error(`✗ Audit couldn't run: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}
if (report) {
  for (const note of report.notes) console.log(`  · ${note}`);
  if (report.failures.length) {
    for (const f of report.failures) console.log(`  ✗ ${f}`);
    console.log(`✗ ${report.failures.length} problem(s) found`);
    process.exitCode = 1;
  } else {
    console.log("✓ No data leaks: RLS, policies, privileges and per-user visibility all check out");
  }
}
