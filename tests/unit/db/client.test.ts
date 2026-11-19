import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { actAs } from "@/src/db/client";

const dialect = new PgDialect();
const USER = "00000000-0000-4000-8000-000000000001";

describe("actAs (PF-012)", () => {
  it("sets the authenticated role and the user's claims for this transaction only, in one statement", () => {
    const query = dialect.sqlToQuery(actAs({ userId: USER, email: "ana@example.com" }));
    expect(query.sql).toBe(
      "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
    );
    expect(JSON.parse(query.params[0] as string)).toEqual({
      sub: USER,
      role: "authenticated",
      email: "ana@example.com",
    });
    expect(query.params[1]).toBe(USER);
  });

  it("only acts as real Supabase users", () => {
    expect(() => actAs({ userId: "demo-user" })).toThrow();
  });
});
