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

const key = (route: Route) => `${route.method} ${route.path}`;

/**
 * A valid minimal body for every mutating route, so a request gets past input validation and reaches
 * the tenant check (a 400 from `{}` would hide a missing workspace check). `undefined` = no body.
 * A new mutating route with no entry here fails the test.
 */
const VALID_STORY = {
  title: "Filter transactions",
  asA: "customer",
  iWant: "to filter transactions",
  soThat: "I find payments quickly",
  priority: "must",
  requirementCodes: ["FR-01"],
};
const FIXTURES: Record<string, unknown> = {
  "POST /api/projects": {
    name: "Matrix project",
    domain: "Fintech",
    audience: "Retail customers",
    teamSize: 5,
    sprintLengthDays: 14,
  },
  "PATCH /api/projects/[id]": { name: "Renamed project" },
  "DELETE /api/projects/[id]": undefined,
  "POST /api/projects/[id]/sources": { name: "Notes", text: "Customers can export their data." },
  "DELETE /api/projects/[id]/sources/[sourceId]": undefined,
  "POST /api/projects/[id]/discovery": undefined,
  "POST /api/projects/[id]/discovery/confirm": undefined,
  "POST /api/projects/[id]/requirements": {
    text: "Customers can export reports",
    type: "functional",
  },
  "PATCH /api/requirements/[id]": { text: "Customers can export reports as CSV" },
  "PATCH /api/questions/[id]": { state: "skipped" },
  "POST /api/projects/[id]/prd/generate": undefined,
  "PATCH /api/prds/[id]": { section: "summary", value: "A new summary" },
  "POST /api/prds/[id]/approve": undefined,
  "POST /api/prds/[id]/new-version": undefined,
  "POST /api/projects/[id]/backlog/generate": undefined,
  "POST /api/projects/[id]/backlog/approve": undefined,
  "POST /api/projects/[id]/stories": {
    ...VALID_STORY,
    epicId: "00000000-0000-4000-8000-0000000000e1",
  },
  "PATCH /api/stories/[id]": { section: "criteria", value: [] },
  "POST /api/stories/[id]/approve": undefined,
  "POST /api/stories/[id]/reject": { reason: "Not what we meant" },
  "POST /api/stories/[id]/restore": undefined,
  "POST /api/stories/[id]/new-version": undefined,
  "POST /api/stories/[id]/regenerate": { note: "Make it shorter" },
  "POST /api/projects/[id]/changes": {
    kind: "add",
    text: "Customers can pay by invoice",
    type: "functional",
    reason: "A customer asked for it",
  },
  "POST /api/changes/[id]/analyze": undefined,
  "POST /api/changes/[id]/approve": undefined,
  "POST /api/changes/[id]/discard": undefined,
  "POST /api/changes/[id]/reviews": { ref: "PRD", note: "" },
  "POST /api/projects/[id]/sprints/plan": { keepPinned: true },
  "POST /api/projects/[id]/sprints/move": { storyCode: "US-001", sprintNumber: 1 },
  "PUT /api/projects/[id]/sprints/settings": { velocity: 20, startDate: "2026-12-01" },
  "PATCH /api/sprints/[id]": { goal: "Ship the filters" },
  "POST /api/projects/[id]/exports/jira": {
    format: "csv",
    target: "cloud",
    includeTasks: true,
    subtaskType: "Sub-task",
  },
  "POST /api/workspace/api-keys": { name: "Matrix key", scope: "read" },
  "DELETE /api/workspace/api-keys/[id]": undefined,
};

const call = (route: Route, params: Record<string, string>) => {
  const fixture = FIXTURES[key(route)];
  return route.handler(
    new Request(`http://localhost${route.path}?stages=discovery`, {
      method: route.method,
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: route.method === "GET" || fixture === undefined ? undefined : JSON.stringify(fixture),
    }),
    { params: Promise.resolve(params) },
  );
};

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
    // No change request, sprint or API key is created here: unknown ids must answer the same way.
    changes: crypto.randomUUID(),
    sprints: crypto.randomUUID(),
    workspace: crypto.randomUUID(),
  };
}

type Ids = Awaited<ReturnType<typeof seedWorkspaceA>>;
const paramsFor = (path: string, ids: Ids): Record<string, string> | null => {
  if (!path.includes("[")) return null;
  const kind = path.split("/")[2] as keyof Ids;
  if (!(kind in ids))
    throw new Error(`${path}: no seeded id for "${kind}"; add one to seedWorkspaceA (Ids)`);
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
  // Any member may revoke their own key (PF-083, ADR-036). `POST /api/workspace/api-keys` is also
  // member-level but is deliberately not listed: the role sweep only calls routes with an `[id]` in
  // the path, so an entry for it would never be read. It is exercised in api-keys.test.ts.
  "DELETE /api/workspace/api-keys/[id]",
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
  it("every mutating route has a request fixture", async () => {
    const routes = await allRoutes();
    const missing = routes.filter((r) => r.method !== "GET" && !(key(r) in FIXTURES)).map(key);
    expect(missing).toEqual([]);
    const known = new Set(routes.map(key));
    expect(Object.keys(FIXTURES).filter((k) => !known.has(k))).toEqual([]);
  });

  it("another workspace gets 404 (or 403) on every route with A's ids, sees none of A's data, changes nothing", async () => {
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
      if (params && ![403, 404].includes(res.status))
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
