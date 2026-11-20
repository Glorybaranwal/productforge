import { describe, expect, it } from "vitest";

import { describeDbError, pendingMigrations } from "@/scripts/lib/migrate.mjs";

const journal = {
  entries: [
    { tag: "0000_first", when: 100 },
    { tag: "0001_second", when: 200 },
    { tag: "0002_third", when: 300 },
  ],
};

describe("pendingMigrations", () => {
  it("lists every migration on an empty database", () => {
    expect(pendingMigrations(journal, 0)).toEqual(["0000_first", "0001_second", "0002_third"]);
  });
  it("lists only migrations newer than the last applied one", () => {
    expect(pendingMigrations(journal, 200)).toEqual(["0002_third"]);
    expect(pendingMigrations(journal, 300)).toEqual([]);
  });
});

describe("describeDbError", () => {
  it("shows the database's message, fields and the failing statement, not the whole query", () => {
    const cause = Object.assign(
      new Error("function private.has_role(uuid, text[]) does not exist"),
      {
        code: "42883",
        hint: "No function matches the given name and argument types.",
      },
    );
    const err = Object.assign(new Error("Failed query: CREATE POLICY …\nparams: "), {
      query: 'CREATE POLICY "p" ON "requirements" AS PERMISSIVE\nFOR SELECT TO "authenticated"',
      cause,
    });
    const text = describeDbError(err);
    expect(text).toContain("function private.has_role(uuid, text[]) does not exist");
    expect(text).toContain("code: 42883");
    expect(text).toContain("hint: No function matches");
    expect(text).toContain('statement: CREATE POLICY "p" ON "requirements" AS PERMISSIVE');
    expect(text).not.toContain("Failed query");
  });
  it("handles connection errors without a message", () => {
    expect(describeDbError(Object.assign(new Error(""), { code: "ECONNREFUSED" }))).toContain(
      "ECONNREFUSED",
    );
  });
  it("never prints credentials from a connection string", () => {
    const text = describeDbError(
      new Error("cannot reach postgresql://postgres.ref:s3cret@host:5432/db"),
    );
    expect(text).not.toContain("s3cret");
    expect(text).toContain("postgresql://***@host:5432/db");
  });
});
