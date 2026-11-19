import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  auditLogs,
  MEMBER_ROLES,
  memberRole,
  projects,
  workspaceMembers,
  workspaces,
} from "@/src/db/schema";
import { ROLES } from "@/src/lib/auth";
import { AuditLog } from "@/src/modules/audit/schema";
import { Project } from "@/src/modules/projects/schema";
import { Workspace, WorkspaceMember } from "@/src/modules/workspaces/schema";

const TABLES: PgTable[] = [workspaces, workspaceMembers, projects, auditLogs];
const MIGRATIONS = fileURLToPath(new URL("../../../src/db/migrations/", import.meta.url));

describe("database schema (PF-011)", () => {
  it("has a column for every field of the domain types", () => {
    const pairs: [PgTable, { shape: Record<string, unknown> }][] = [
      [workspaces, Workspace],
      [workspaceMembers, WorkspaceMember],
      [projects, Project],
      [auditLogs, AuditLog],
    ];
    for (const [table, type] of pairs) {
      const columns = Object.keys(getTableColumns(table));
      expect({
        table: getTableName(table),
        missing: Object.keys(type.shape).filter((f) => !columns.includes(f)),
      }).toEqual({
        table: getTableName(table),
        missing: [],
      });
    }
  });

  it("keeps member roles in step with the app's roles", () => {
    expect(MEMBER_ROLES).toEqual(ROLES);
    expect(memberRole.enumValues).toEqual([...ROLES]);
  });

  it("turns row-level security on for every table", () => {
    for (const table of TABLES)
      expect({ table: getTableName(table), rls: getTableConfig(table).enableRLS }).toEqual({
        table: getTableName(table),
        rls: true,
      });
  });

  it("has generated migrations that create every table with RLS on", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    const all = files.map((f) => readFileSync(`${MIGRATIONS}${f}`, "utf8")).join("\n");
    for (const table of TABLES) {
      const name = getTableName(table);
      expect(all).toContain(`CREATE TABLE "${name}"`);
      expect(all).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`);
    }
  });
});
