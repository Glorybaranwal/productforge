// `pnpm db:check` — can we reach the database with the password in .env.local, and what's in it?
import postgres from "postgres";

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

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [me] =
    await sql`select current_user as "user", current_setting('server_version') as version`;
  console.log(`✓ Connected as ${me.user} (Postgres ${me.version})`);
  const tables = await sql`
    select c.relname as name, c.relrowsecurity as rls,
      (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1`;
  if (!tables.length) {
    console.log("  No tables yet — run pnpm db:migrate.");
  } else {
    for (const t of tables) {
      // Identifiers come from pg_class, not from input.
      const [{ rows }] = await sql`select count(*)::int as rows from ${sql("public." + t.name)}`;
      const detail = `${t.policies} ${t.policies === 1 ? "policy" : "policies"}, ${rows} ${rows === 1 ? "row" : "rows"}`;
      console.log(
        `  ${t.rls ? "✓" : "✗"} ${t.name} — ${detail}${t.rls ? "" : "  ← row-level security is OFF"}`,
      );
    }
    if (tables.some((t) => !t.rls)) process.exitCode = 1;
  }
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? err.code : "";
  console.error(`✗ Couldn't connect: ${err instanceof Error ? err.message : String(err)}`);
  if (code === "28P01" || code === "XX000")
    console.error(
      "  Check the database password in .env.local (Supabase → Database → Settings → Reset password).",
    );
  if (code === "ENOTFOUND" || code === "ECONNREFUSED")
    console.error("  Check the host in DATABASE_DIRECT_URL and your internet connection.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
