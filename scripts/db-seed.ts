// `pnpm db:seed -- --email you@example.com` — creates the demo project for that user (PF-064).
// Needs DATA_DRIVER=postgres and a user who has signed in once (so they exist in auth.users).
// Writes through the app's own services as that user, so RLS applies; adminDb() only looks the user up.
import { sql } from "drizzle-orm";

import { adminDb } from "@/src/db/client";
import { appUrl } from "@/src/lib/supabase/config";
import { seedDemoProject } from "@/src/modules/projects/demo-seed";
import { ensureWorkspace } from "@/src/modules/workspaces/service";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fall back to the environment (CI).
}

if (process.env.DATA_DRIVER !== "postgres") {
  fail(
    "db:seed needs DATA_DRIVER=postgres (set it in .env.local). It seeds the Supabase database.",
  );
}

const args = process.argv.slice(2);
const at = args.indexOf("--email");
const email = (at >= 0 ? args[at + 1] : undefined)?.trim().toLowerCase();
if (!email) fail("Usage: pnpm db:seed -- --email you@example.com");

try {
  const rows = await adminDb().execute<{ id: string; name: string | null }>(
    sql`select id, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') as name
        from auth.users where lower(email) = ${email} limit 1`,
  );
  const user = rows[0];
  if (!user)
    fail(`No user with the email ${email}. Sign in once with this email first, then re-run.`);

  const ctx = await ensureWorkspace({
    userId: user.id,
    name: user.name?.trim() || email.split("@")[0]!,
    email,
  });
  const { projectId, created } = await seedDemoProject(ctx);
  console.log(
    created ? "Created the demo project." : "The demo project already exists; nothing changed.",
  );
  console.log(`${appUrl()}/dashboard/projects/${projectId}`);
} catch (err) {
  console.error(`db:seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await (
    globalThis as { __productforgePg?: { close?: () => Promise<void> } }
  ).__productforgePg?.close?.();
}
process.exit(process.exitCode ?? 0);
