import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setLLMClient } from "@/src/ai/llm-client";
import { transact } from "@/src/db/store";
import { DEMO_USER, type Role } from "@/src/lib/auth";
import { actAs } from "@/src/lib/test-session";
import { resetDb } from "@/tests/helpers/context";
import { projectThroughGate2 } from "@/tests/helpers/backlog";

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Route = { path: string; method: string; handler: Handler };
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
const API = join(process.cwd(), "app/api");

/** Every handler under app/api, found on disk so a new route is covered without editing this test. */
async function allRoutes(): Promise<Route[]> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") files.push(full);
    }
  };
  walk(API);
  const routes: Route[] = [];
  for (const file of files.sort()) {
    const mod = (await import(file)) as Record<string, unknown>;
    const path = "/api/" + relative(API, file).replace(/\/?route\.ts$/, "");
    for (const method of METHODS)
      if (typeof mod[method] === "function")
        routes.push({ path, method, handler: mod[method] as Handler });
  }
  return routes;
}

const call = (route: Route, params: Record<string, string>) =>
  route.handler(
    new Request(`http://localhost${route.path}?stages=discovery`, {
      method: route.method,
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: route.method === "GET" ? undefined : "{}",
    }),
    { params: Promise.resolve(params) },
  );

const get = async (route: Route | undefined, params: Record<string, string>) =>
  route ? (await call(route, params)).text() : "";

/** Workspace A's ids, one per kind of `[id]` in the route paths. */
async function seedWorkspaceA(routes: Route[]) {
  const { projectId } = await projectThroughGate2();
  const find = (path: string) => routes.find((r) => r.path === path && r.method === "GET");
  const genBacklog = routes.find((r) => r.path === "/api/projects/[id]/backlog/generate");
  await call(genBacklog!, { id: projectId });
  const discovery = JSON.parse(await get(find("/api/projects/[id]/discovery"), { id: projectId }));
  const prd = JSON.parse(await get(find("/api/projects/[id]/prd"), { id: projectId }));
  const backlog = JSON.parse(await get(find("/api/projects/[id]/backlog"), { id: projectId }));
  return {
    projects: projectId,
    requirements: discovery.requirements[0].id as string,
    questions: (discovery.questions[0]?.id ?? crypto.randomUUID()) as string,
    sourceId: discovery.sources[0].id as string,
    "agent-runs": discovery.latestRun.id as string,
    prds: prd.versions[0].id as string,
    stories: backlog.stories[0].id as string,
    // No change request or sprint is created here: unknown ids must answer the same way.
    changes: crypto.randomUUID(),
    sprints: crypto.randomUUID(),
  };
}

type Ids = Awaited<ReturnType<typeof seedWorkspaceA>>;
const paramsFor = (path: string, ids: Ids): Record<string, string> | null => {
  if (!path.includes("[")) return null;
  const kind = path.split("/")[2] as keyof Ids;
  return { id: ids[kind], ...(path.includes("[sourceId]") ? { sourceId: ids.sourceId } : {}) };
};

/** What A sees, to prove nothing changed. */
async function snapshot(routes: Route[], ids: Ids) {
  const reads = routes.filter(
    (r) =>
      r.method === "GET" &&
      /^\/api\/projects\/\[id\]\/(discovery|prd|backlog|traceability)$/.test(r.path),
  );
  return Promise.all(reads.map((r) => get(r, { id: ids.projects })));
}

/**
 * What every member may do (ADR-012, ADR-027–029): add sources, add and edit drafts, answer questions,
 * start a new draft version, export. Generating, approving, planning and project settings stay with
 * owners, admins and PMs. A route missing here and not answering 403 to a developer fails the test.
 */
const MEMBER_WRITES = [
  "POST /api/projects/[id]/sources",
  "DELETE /api/projects/[id]/sources/[sourceId]",
  "POST /api/projects/[id]/requirements",
  "PATCH /api/requirements/[id]",
  "PATCH /api/questions/[id]",
  "PATCH /api/prds/[id]",
  "POST /api/prds/[id]/new-version",
  "PATCH /api/stories/[id]",
  "POST /api/projects/[id]/exports/jira",
];

const setRole = (role: Role) =>
  transact((state) => {
    for (const m of state.workspaceMembers) if (m.userId === DEMO_USER.userId) m.role = role;
  });

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
  process.env.AI_RUNS_PER_USER_PER_MINUTE = "1000";
});
afterEach(() => {
  actAs(null);
  delete process.env.AI_RUNS_PER_USER_PER_MINUTE;
});

describe("route matrix (test plan §4–5, ADR-035)", () => {
  it("another workspace gets 404 (or 400) on every route with A's ids, sees none of A's data, changes nothing", async () => {
    const routes = await allRoutes();
    expect(routes.length).toBeGreaterThan(40);
    const ids = await seedWorkspaceA(routes);
    const before = await snapshot(routes, ids);
    const marker = before.join("").includes(ids.projects) ? ids.projects : "";
    expect(marker).not.toBe("");

    actAs({
      userId: "00000000-0000-4000-8000-0000000000b2",
      name: "Other",
      email: "b@example.com",
    });
    const leaks: string[] = [];
    for (const route of routes) {
      const params = paramsFor(route.path, ids);
      const res = await call(route, params ?? {});
      const body = await res.text();
      if (params && ![400, 404].includes(res.status))
        leaks.push(`${route.method} ${route.path} → ${res.status}`);
      for (const id of Object.values(ids))
        if (body.includes(id)) leaks.push(`${route.method} ${route.path} shows ${id}`);
    }
    expect(leaks).toEqual([]);

    actAs(null);
    expect(await snapshot(routes, ids)).toEqual(before);
  });

  it("developers and QA get 403 on every manager-only route", async () => {
    const routes = await allRoutes();
    const ids = await seedWorkspaceA(routes);
    const writes = routes.filter((r) => r.method !== "GET" && paramsFor(r.path, ids));

    for (const role of ["developer", "qa"] as Role[]) {
      await setRole(role);
      const allowed: string[] = [];
      for (const route of writes) {
        const res = await call(route, paramsFor(route.path, ids)!);
        if (res.status !== 403 && !MEMBER_WRITES.includes(`${route.method} ${route.path}`))
          allowed.push(`${role} ${route.method} ${route.path} → ${res.status}`);
      }
      expect(allowed).toEqual([]);
    }
    await setRole("owner");
  });
});
