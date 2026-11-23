import { describe, expect, it } from "vitest";

import {
  gate,
  BUCKET_HEADER,
  isCrossSiteWrite,
  rateBucket,
  requestSurface,
  safeNext,
  SURFACE_HEADER,
} from "@/src/lib/auth-gate";

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

describe("requestSurface (PF-083)", () => {
  it("calls /api GET, HEAD and OPTIONS reads, and every other method on /api a write", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"])
      expect(requestSurface("/api/projects", method)).toBe("api-read");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "PURGE"])
      expect(requestSurface("/api/projects/p1", method)).toBe("api-write");
  });

  it("calls everything outside /api a page, so an API key is never honoured there", () => {
    for (const path of ["/dashboard", "/dashboard/projects/p1", "/login", "/auth/callback", "/"])
      for (const method of ["GET", "POST"]) expect(requestSurface(path, method)).toBe("page");
  });

  it("matches /api by path segment, not by prefix", () => {
    expect(requestSurface("/api", "GET")).toBe("api-read");
    expect(requestSurface("/apiary", "GET")).toBe("page");
    expect(requestSurface("/dashboard/api/x", "GET")).toBe("page");
  });

  it("treats HEAD as a read, as Next runs the GET handler for it (exports may append an audit row)", () => {
    expect(requestSurface("/api/prds/p1/markdown", "HEAD")).toBe("api-read");
    expect(requestSurface("/api/projects/p1/traceability/csv", "GET")).toBe("api-read");
  });

  it("names the header the app reads", () => {
    expect(SURFACE_HEADER).toBe("x-pf-surface");
  });
});

describe("rateBucket (PF-084)", () => {
  it("never meters anything that is not under /api, whatever the method", () => {
    for (const path of [
      "/",
      "/login",
      "/auth/callback",
      "/dashboard",
      "/dashboard/projects/p1",
      "/apiary",
      "/dashboard/api/x",
    ])
      for (const method of ["GET", "POST", "DELETE"])
        expect(rateBucket(path, method), `${method} ${path}`).toBeNull();
  });

  it("puts a source upload in `upload`, but listing sources is a read", () => {
    expect(rateBucket("/api/projects/p1/sources", "POST")).toBe("upload");
    expect(rateBucket("/api/projects/p1/sources", "GET")).toBe("read");
    expect(rateBucket("/api/projects/p1/sources/s1", "DELETE")).toBe("write");
  });

  it("puts the four export routes in `export`", () => {
    expect(rateBucket("/api/prds/p1/markdown", "GET")).toBe("export");
    expect(rateBucket("/api/projects/p1/backlog/markdown", "GET")).toBe("export");
    expect(rateBucket("/api/projects/p1/traceability/csv", "GET")).toBe("export");
    expect(rateBucket("/api/projects/p1/exports/jira", "POST")).toBe("export");
    // The export history list is not an export.
    expect(rateBucket("/api/projects/p1/exports", "GET")).toBe("read");
  });

  it("puts every route that reaches the stage runner in `generate`", () => {
    for (const path of [
      "/api/projects/p1/discovery",
      "/api/projects/p1/prd/generate",
      "/api/projects/p1/backlog/generate",
      "/api/changes/c1/analyze",
      "/api/projects/p1/changes",
      "/api/stories/s1/regenerate",
    ])
      expect(rateBucket(path, "POST"), path).toBe("generate");
  });

  it("does not class the deterministic sprint planner or reading a generation's state as `generate`", () => {
    expect(rateBucket("/api/projects/p1/sprints/plan", "POST")).toBe("write");
    expect(rateBucket("/api/projects/p1/discovery", "GET")).toBe("read");
    expect(rateBucket("/api/projects/p1/changes", "GET")).toBe("read");
  });

  it("makes every other non-safe method a `write` and every safe one a `read`", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      expect(rateBucket("/api/projects/p1", method)).toBe("write");
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect(rateBucket("/api/projects/p1", method)).toBe("read");
    expect(rateBucket("/api/projects", "post")).toBe("write");
  });

  it("is not dodged by a doubled or trailing slash", () => {
    expect(rateBucket("/api/projects/p1//sources", "POST")).toBe("upload");
    expect(rateBucket("/api/projects/p1/sources/", "POST")).toBe("upload");
  });

  it("names the header the app reads", () => {
    expect(BUCKET_HEADER).toBe("x-pf-bucket");
  });
});
