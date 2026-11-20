/**
 * The data-isolation audit behind `pnpm db:audit` (ADR-023): clean on the real migrations, and it
 * catches the leaks it's meant to catch when the database is deliberately broken.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";

import { createRlsDb, type RlsHarness } from "./rls-harness";

let h: RlsHarness;

beforeAll(async () => {
  h = await createRlsDb();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

/** Runs the audit after `breakIt`, all in one transaction that's rolled back. */
async function audit(breakIt = "") {
  let report: Awaited<ReturnType<typeof auditDataIsolation>> | undefined;
  await h.pg.transaction(async (tx) => {
    if (breakIt) await tx.exec(breakIt);
    report = await auditDataIsolation(
      async (sql, params) => (await tx.query(sql, params)).rows as Record<string, unknown>[],
    );
    await tx.rollback();
  });
  return report!;
}

describe("data-isolation audit (ADR-023)", () => {
  it("finds nothing wrong with the real migrations", async () => {
    const report = await audit();
    expect(report.failures).toEqual([]);
    expect(report.notes).toContain("checked 5 members across 20 tables");
  });

  it("catches a policy that lets everyone read projects", async () => {
    const { failures } = await audit(
      "create policy leak on public.projects for select to authenticated using (true)",
    );
    expect(failures).toContain("policy projects.leak is open to everyone");
    expect(failures).toContain("a stranger can read 2 rows of projects");
    expect(failures.some((f) => /sees \d+ projects rows from other workspaces/.test(f))).toBe(true);
  });

  it("catches reopened privileges and a table without RLS", async () => {
    const { failures } = await audit(`
      grant select on public.projects to anon;
      grant truncate on public.workspaces to authenticated;
      alter table public.audit_logs disable row level security;
    `);
    expect(failures).toEqual(
      expect.arrayContaining([
        "anon has SELECT on projects",
        "authenticated has TRUNCATE on workspaces",
        "table audit_logs has row-level security OFF",
      ]),
    );
  });
});
