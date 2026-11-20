// Data-isolation audit (ADR-023): probes a database the way an attacker would, without changing it.
// `exec(sql, params)` must run inside ONE transaction that the caller rolls back afterwards.
// Returns { failures, notes }: any failure is a leak or a missing safeguard.

const STRANGER = "00000000-0000-4000-8000-0000deadbeef";

export async function auditDataIsolation(exec) {
  const failures = [];
  const notes = [];
  const fail = (msg) => failures.push(msg);
  let n = 0;

  /** Runs `sql` as `role` (and user `sub`) in a savepoint, so errors and role changes are undone. */
  async function as(role, sub, sql, params = []) {
    const sp = `probe_${++n}`;
    await exec(`savepoint ${sp}`);
    try {
      await exec(
        "select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claims', $3, true)",
        [role, sub ?? "", sub ? JSON.stringify({ sub, role }) : ""],
      );
      return { rows: await exec(sql, params) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      await exec(`rollback to savepoint ${sp}`);
    }
  }

  // 1. Every table has RLS, and no policy is open to everyone.
  const noRls = await exec(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  for (const r of noRls) fail(`table ${r.relname} has row-level security OFF`);
  const openPolicies = await exec(
    `select tablename, policyname from pg_policies where schemaname = 'public'
     and (roles && array['public', 'anon']::name[] or qual = 'true' or with_check = 'true')`,
  );
  for (const p of openPolicies) fail(`policy ${p.tablename}.${p.policyname} is open to everyone`);

  // 2. Privileges: visitors get nothing; signed-in users can't truncate; the audit trail is insert-only.
  const grants = await exec(
    `select grantee, table_name, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')`,
  );
  for (const g of grants) {
    if (g.grantee === "anon") fail(`anon has ${g.privilege_type} on ${g.table_name}`);
    else if (["TRUNCATE", "REFERENCES", "TRIGGER"].includes(g.privilege_type))
      fail(`authenticated has ${g.privilege_type} on ${g.table_name}`);
    else if (g.table_name === "audit_logs" && ["UPDATE", "DELETE"].includes(g.privilege_type))
      fail(`authenticated can ${g.privilege_type} the audit trail`);
  }

  // 3. The membership functions: hidden from visitors, run as owner, fixed search_path.
  const [priv] = await exec(
    `select has_schema_privilege('anon', 'private', 'USAGE') as anon_usage,
            has_schema_privilege('authenticated', 'private', 'USAGE') as user_usage`,
  );
  if (priv.anon_usage) fail("anon can use the private schema");
  const fns = await exec(
    `select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'`,
  );
  for (const f of fns) {
    if (!f.prosecdef) fail(`private.${f.proname} isn't SECURITY DEFINER`);
    if (!f.config.includes("search_path")) fail(`private.${f.proname} has no fixed search_path`);
  }

  // Every table that holds workspace data: `workspaces` itself, and each table with a workspace_id.
  const scoped = await exec(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'workspace_id' order by 1`,
  );
  const TABLES = ["workspaces", ...scoped.map((r) => r.table_name)];

  // 4. A visitor who isn't signed in, and a signed-in stranger with no workspace, see nothing.
  for (const table of TABLES) {
    const anon = await as("anon", null, `select count(*)::int as n from public.${table}`);
    if (!anon.error && anon.rows[0].n > 0) fail(`anon can read ${anon.rows[0].n} rows of ${table}`);
    const stranger = await as(
      "authenticated",
      STRANGER,
      `select count(*)::int as n from public.${table}`,
    );
    if (stranger.error) fail(`a stranger's read of ${table} failed: ${stranger.error}`);
    else if (stranger.rows[0].n > 0)
      fail(`a stranger can read ${stranger.rows[0].n} rows of ${table}`);
  }

  // 5. Each real member sees only rows from their own workspaces (checked against the truth).
  const users = await exec(`select distinct user_id from public.workspace_members limit 100`);
  for (const { user_id: user } of users) {
    const mine = new Set(
      (
        await exec(`select workspace_id from public.workspace_members where user_id = $1`, [user])
      ).map((r) => r.workspace_id),
    );
    const owned = (await exec(`select id from public.workspaces where owner_id = $1`, [user])).map(
      (r) => r.id,
    );
    const allowedWorkspaces = new Set([...mine, ...owned]);
    const seen = {};
    for (const table of TABLES) {
      const column = table === "workspaces" ? "id" : "workspace_id";
      seen[table] = await as("authenticated", user, `select ${column} as ws from public.${table}`);
    }
    for (const [table, result] of Object.entries(seen)) {
      if (result.error) {
        fail(`user ${user.slice(0, 8)}… can't read ${table}: ${result.error}`);
        continue;
      }
      const allowed = table === "workspaces" ? allowedWorkspaces : mine;
      const leaked = result.rows.filter((r) => !allowed.has(r.ws));
      if (leaked.length)
        fail(`user ${user.slice(0, 8)}… sees ${leaked.length} ${table} rows from other workspaces`);
    }
  }
  notes.push(
    `checked ${users.length} member${users.length === 1 ? "" : "s"} across ${TABLES.length} tables`,
  );

  // 6. Supabase's Data API (PostgREST): the app doesn't use it, so it shouldn't expose our tables.
  const [api] = await exec(
    `select array_to_string(rolconfig, ',') as config from pg_roles where rolname = 'authenticator'`,
  ).catch(() => [undefined]);
  if (api?.config?.match(/pgrst\.db_schemas=[^,]*\bpublic\b/))
    notes.push(
      "Data API exposes the public schema (RLS still applies; turn it off in Settings → Data API)",
    );

  return { failures, notes };
}
