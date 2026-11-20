/**
 * Table privileges (ADR-023). RLS filters rows, but not TRUNCATE, and Supabase grants every
 * privilege on new tables to `anon` and `authenticated`. These tests pin the hardened grants so a
 * future migration can't quietly reopen them.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, projects } from "@/src/db/schema";

import { createRlsDb, failure, type RlsHarness, USERS } from "./rls-harness";

let h: RlsHarness;

beforeAll(async () => {
  h = await createRlsDb();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

async function privileges(role: string): Promise<Record<string, string[]>> {
  const { rows } = await h.pg.query<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = $1 order by 1, 2`,
    [role],
  );
  const byTable: Record<string, string[]> = {};
  for (const r of rows) (byTable[r.table_name] ??= []).push(r.privilege_type);
  return byTable;
}

describe("table privileges (ADR-023)", () => {
  it("gives anonymous visitors nothing", async () => {
    expect(await privileges("anon")).toEqual({});
  });

  it("gives signed-in users only what the policies use; the audit trail is insert-only", async () => {
    const write = ["DELETE", "INSERT", "SELECT", "UPDATE"];
    expect(await privileges("authenticated")).toEqual({
      acceptance_criteria: write,
      // The run log is never deleted; idempotency records are never changed (ADR-027).
      agent_runs: ["INSERT", "SELECT", "UPDATE"],
      audit_logs: ["INSERT", "SELECT"],
      clarifying_questions: write,
      discoveries: write,
      // Epics, stories and PRD versions are never deleted (ADR-028, ADR-029).
      epics: ["INSERT", "SELECT", "UPDATE"],
      idempotency_records: ["INSERT", "SELECT"],
      // A PRD version is never deleted (ADR-028).
      prds: ["INSERT", "SELECT", "UPDATE"],
      projects: write,
      requirements: write,
      source_documents: write,
      stories: ["INSERT", "SELECT", "UPDATE"],
      technical_tasks: write,
      workspace_members: write,
      workspaces: write,
    });
  });

  it("stops any signed-in user, member or not, from emptying a table", async () => {
    for (const user of [USERS.ana, USERS.newbie]) {
      expect(await failure(h.as(user, (tx) => tx.execute(sql`truncate ${projects}`)))).toMatch(
        /permission denied/,
      );
      expect(await failure(h.as(user, (tx) => tx.delete(auditLogs)))).toMatch(/permission denied/);
    }
  });
});
