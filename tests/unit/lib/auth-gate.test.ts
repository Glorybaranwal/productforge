import { describe, expect, it } from "vitest";

import { gate, isCrossSiteWrite, safeNext } from "@/src/lib/auth-gate";

const at = (path: string) => {
  const url = new URL(path, "http://localhost:3000");
  return { pathname: url.pathname, search: url.search };
};

describe("gate (PF-013)", () => {
  it("sends signed-out visitors from the dashboard to sign-in, remembering where they were", () => {
    expect(gate(at("/dashboard"), false)).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fdashboard",
    });
    expect(gate(at("/dashboard/projects/p1/prd?tab=items"), false)).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fdashboard%2Fprojects%2Fp1%2Fprd%3Ftab%3Ditems",
    });
  });

  it("answers signed-out API calls with 401 instead of a redirect", () => {
    expect(gate(at("/api/projects"), false)).toEqual({ kind: "unauthorized" });
    expect(gate(at("/api"), false)).toEqual({ kind: "unauthorized" });
  });

  it("lets signed-in users through", () => {
    expect(gate(at("/dashboard/projects/p1"), true)).toEqual({ kind: "next" });
    expect(gate(at("/api/projects"), true)).toEqual({ kind: "next" });
  });

  it("forwards signed-in users away from the sign-in page", () => {
    expect(gate(at("/login"), true)).toEqual({ kind: "redirect", to: "/dashboard" });
    expect(gate(at("/login?next=%2Fdashboard%2Fprojects%2Fp1"), true)).toEqual({
      kind: "redirect",
      to: "/dashboard/projects/p1",
    });
  });

  it("leaves public pages and look-alike paths alone", () => {
    for (const path of ["/", "/login", "/auth/callback?code=x", "/dashboards", "/apiary"])
      expect(gate(at(path), false)).toEqual({ kind: "next" });
  });
});

describe("safeNext (PF-013)", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/dashboard/projects/p1?tab=prd#items")).toBe(
      "/dashboard/projects/p1?tab=prd#items",
    );
  });

  it.each([
    null,
    "",
    "dashboard",
    "https://evil.example/dashboard",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "/login",
    "/login?next=/login",
    "/auth/callback?code=x",
  ])("falls back to the dashboard for %j", (raw) => {
    expect(safeNext(raw)).toBe("/dashboard");
  });
});

describe("isCrossSiteWrite (ADR-023)", () => {
  const SELF = "http://localhost:3000";
  const req = (
    method: string,
    pathname: string,
    origin: string | null,
    site: string | null = null,
  ) => isCrossSiteWrite({ method, pathname, selfOrigin: SELF, origin, secFetchSite: site });

  it("refuses writes to the API and auth routes from another site", () => {
    expect(req("POST", "/api/projects", "https://evil.example")).toBe(true);
    expect(req("DELETE", "/api/projects/p1", "null")).toBe(true);
    expect(req("POST", "/auth/signout", null, "cross-site")).toBe(true);
  });

  it("allows same-site writes, reads, and tools that send no browser headers", () => {
    expect(req("POST", "/api/projects", SELF)).toBe(false);
    expect(req("PATCH", "/api/projects/p1", null, "same-origin")).toBe(false);
    expect(req("GET", "/api/projects", "https://evil.example")).toBe(false);
    expect(req("POST", "/api/projects", null)).toBe(false);
    expect(req("POST", "/login", "https://evil.example")).toBe(false);
  });
});
