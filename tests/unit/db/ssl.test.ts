import { describe, expect, it } from "vitest";

import { sslFor } from "@/src/db/ssl.mjs";

describe("sslFor", () => {
  it("encrypts connections to a hosted database", () => {
    expect(sslFor("postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toBe(
      "require",
    );
    expect(sslFor("postgresql://u:p@db.example.co:5432/postgres")).toBe("require");
  });
  it("leaves a database on this machine unencrypted", () => {
    expect(sslFor("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe(false);
    expect(sslFor("postgresql://postgres:postgres@localhost:54322/postgres")).toBe(false);
  });
  it("lets an sslmode in the URL decide", () => {
    expect(
      sslFor("postgresql://u:p@db.example.co:5432/postgres?sslmode=verify-full"),
    ).toBeUndefined();
  });
  it("encrypts when the URL can't be parsed", () => {
    expect(sslFor("not a url")).toBe("require");
  });
});
