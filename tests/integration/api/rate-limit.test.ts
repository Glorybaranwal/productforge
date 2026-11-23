/**
 * HTTP rate limits through the route handlers (PF-084, ADR-037): the 11th upload in a minute is
 * refused with `Retry-After`, a key and its owner meter separately, a page is never metered, a bad key
 * costs no counter write, and the live-view cap is keyed by principal.
 *
 * `next/headers` is replaced so each call looks like a request that went through `proxy.ts`: the
 * `Authorization` header plus the surface and rate-limit class headers the proxy stamps (derived
 * from the proxy's own rules, never restated here). The routes run on the demo store; the counter
 * runs on PGlite with the real migrations, reached through `adminDb()`.
 *
 * Time is frozen mid-window so a minute boundary cannot split a burst. Only `Date` is faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as keysRoute from "@/app/api/workspace/api-keys/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as liveRoute from "@/app/api/projects/[id]/runs/live/route";
import * as sourcesRoute from "@/app/api/projects/[id]/sources/route";
import * as projectsRoute from "@/app/api/projects/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { rateLimitHits } from "@/src/db/schema";
import { rateBucket, requestSurface } from "@/src/lib/auth-gate";
import { DEMO_USER } from "@/src/lib/auth";
import { currentContext } from "@/src/modules/workspaces/service";
import { resetDb, validProject } from "@/tests/helpers/context";

import { createRlsDb, type RlsHarness } from "../db/rls-harness";

const request = vi.hoisted(() => ({ headers: null as Record<string, string> | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!request.headers) throw new Error("`headers` was called outside a request scope");
    return new Headers(request.headers);
  },
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/db/client")>()),
  adminDb: () => holder.db,
}));

const T0 = new Date("2026-11-23T10:15:10.000Z");
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Runs `fn` as the proxy would hand a request to the app, optionally carrying an API key. */
async function asRequest<T>(path: string, method: string, fn: () => Promise<T>, key?: string) {
  request.headers = {
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    "x-pf-surface": requestSurface(path, method),
    ...(rateBucket(path, method) ? { "x-pf-bucket": rateBucket(path, method)! } : {}),
  };
  try {
    return await fn();
  } finally {
    request.headers = null;
  }
}

let h: RlsHarness;
let projectId: string;

const upload = (key?: string) =>
  asRequest(
    `/api/projects/${projectId}/sources`,
    "POST",
    () => {
      const body = new FormData();
      body.append(
        "file",
        new File(["Customers can export data."], "notes.txt", { type: "text/plain" }),
      );
      return sourcesRoute.POST(
        new Request(`http://localhost/api/projects/${projectId}/sources`, { method: "POST", body }),
        params(projectId),
      );
    },
    key,
  );
const readProject = (key?: string) =>
  asRequest(
    `/api/projects/${projectId}`,
    "GET",
    () => projectRoute.GET(new Request("http://localhost/api/x"), params(projectId)),
    key,
  );
const hitsFor = async () => (await h.db.select().from(rateLimitHits)).map((r) => r.principal);

async function mintKey(scope: "read" | "write"): Promise<{ id: string; plaintext: string }> {
  const res = await keysRoute.POST(json("POST", { name: `${scope} key`, scope }));
  expect(res.status).toBe(201);
  const { key, plaintext } = (await res.json()) as { key: { id: string }; plaintext: string };
  return { id: key.id, plaintext };
}

beforeAll(async () => {
  h = await createRlsDb();
});
afterAll(async () => {
  await h.pg.close();
});
beforeEach(async () => {
  holder.db = h.db;
  await h.db.delete(rateLimitHits);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.stubEnv("DATABASE_URL", "postgres://counter.invalid/db"); // metering needs a database to count in
  resetDb();
  setLLMClient(undefined);
  request.headers = null;
  const created = await projectsRoute.POST(json("POST", validProject));
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
});
afterEach(() => {
  request.headers = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("uploads (PF-084)", () => {
  it("allows 10 uploads in a minute and refuses the 11th with 429 and Retry-After", async () => {
    for (let i = 1; i <= 10; i += 1) expect((await upload()).status, `upload ${i}`).toBe(201);
    const refused = await upload();
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get("retry-after"));
    // T0 is 10 s into the window, so exactly 50 s remain.
    expect(wait).toBe(50);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });

  it("starts again in the next window", async () => {
    for (let i = 0; i < 11; i += 1) await upload();
    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    expect((await upload()).status).toBe(201);
  });
});

describe("who is metered (PF-084)", () => {
  it("meters a key as itself: exhausting a key's reads leaves its owner's allowance untouched", async () => {
    const key = await mintKey("read");
    vi.stubEnv("RATE_LIMIT_READ_PER_MIN", "3");
    for (let i = 0; i < 3; i += 1) expect((await readProject(key.plaintext)).status).toBe(200);
    const refused = await readProject(key.plaintext);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("50");
    // The owner, on a cookie session, still has all 3.
    for (let i = 0; i < 3; i += 1) expect((await readProject()).status).toBe(200);
    expect((await readProject()).status).toBe(429);
    const principals = (await hitsFor()).sort();
    expect(principals).toEqual([`key:${key.id}`, `user:${DEMO_USER.userId}`].sort());
  });

  it("does not meter a page render, and writes no counter row for one", async () => {
    vi.stubEnv("RATE_LIMIT_READ_PER_MIN", "1");
    for (let i = 0; i < 20; i += 1) {
      request.headers = { "x-pf-surface": requestSurface("/dashboard", "GET") };
      try {
        // The class header is absent on a page: the proxy removes it. `currentContext` is not
        // `cache`d across these calls because each runs outside a React render.
        await currentContext();
      } finally {
        request.headers = null;
      }
    }
    expect(await hitsFor()).toEqual([]);
  });

  it("ignores a forged class on a page: the proxy never lets one through, and no header means no meter", async () => {
    // The proxy removes `x-pf-bucket` on a page; with it absent nothing is counted.
    request.headers = { "x-pf-surface": "page" };
    try {
      await currentContext();
    } finally {
      request.headers = null;
    }
    expect(await hitsFor()).toEqual([]);
  });

  it("costs a bad key no counter write", async () => {
    const bad = `pf_test_abcdefgh_${"A".repeat(43)}`;
    const res = await readProject(bad);
    expect(res.status).toBe(401);
    expect(await hitsFor()).toEqual([]);
  });

  it("meters nothing without a database (demo mode)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    for (let i = 0; i < 12; i += 1) expect((await upload()).status).toBe(201);
    expect(await hitsFor()).toEqual([]);
  });
});

describe("the live-view cap is per principal (PF-084)", () => {
  it("lets a key hold its own 5 streams without using the owner's slots", async () => {
    const key = await mintKey("read");
    const aborts: AbortController[] = [];
    const open = (plaintext?: string) => {
      const abort = new AbortController();
      aborts.push(abort);
      const path = `/api/projects/${projectId}/runs/live`;
      return asRequest(
        path,
        "GET",
        () =>
          liveRoute.GET(
            new Request(`http://localhost${path}?stages=discovery`, { signal: abort.signal }),
            params(projectId),
          ),
        plaintext,
      );
    };
    try {
      vi.stubEnv("RATE_LIMIT_READ_PER_MIN", "1000");
      for (let i = 0; i < liveRoute.MAX_STREAMS_PER_USER; i += 1)
        expect((await open(key.plaintext)).status, `key stream ${i + 1}`).toBe(200);
      const refused = await open(key.plaintext);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe("5");
      // The owner still has all five, because the key's streams were counted under the key.
      for (let i = 0; i < liveRoute.MAX_STREAMS_PER_USER; i += 1)
        expect((await open()).status, `owner stream ${i + 1}`).toBe(200);
      expect((await open()).status).toBe(429);
    } finally {
      for (const abort of aborts) abort.abort();
    }
  });
});
