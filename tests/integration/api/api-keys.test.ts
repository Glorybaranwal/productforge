/**
 * Workspace API keys through the route handlers (PF-083, ADR-036): minting, authenticating with the
 * plaintext, the role and method ceilings, the uniform 401, no approvals, no dashboard, no leaks.
 *
 * `next/headers` is replaced so each call looks like a request that went through `proxy.ts`: the
 * `Authorization` header plus the `x-pf-surface` header the proxy stamps. Run on the demo store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as workspaceRoute from "@/app/api/workspace/route";
import * as keysRoute from "@/app/api/workspace/api-keys/route";
import * as keyRoute from "@/app/api/workspace/api-keys/[id]/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as activityRoute from "@/app/api/projects/[id]/activity/route";
import * as sourcesRoute from "@/app/api/projects/[id]/sources/route";
import * as generatePrdRoute from "@/app/api/projects/[id]/prd/generate/route";
import * as approvePrdRoute from "@/app/api/prds/[id]/approve/route";
import * as approveStoryRoute from "@/app/api/stories/[id]/approve/route";
import * as approveBacklogRoute from "@/app/api/projects/[id]/backlog/approve/route";
import * as confirmDiscoveryRoute from "@/app/api/projects/[id]/discovery/confirm/route";
import * as approveChangeRoute from "@/app/api/changes/[id]/approve/route";
import * as backlogRoute from "@/app/api/projects/[id]/backlog/route";
import * as backlogMarkdownRoute from "@/app/api/projects/[id]/backlog/markdown/route";
import * as generateBacklogRoute from "@/app/api/projects/[id]/backlog/generate/route";
import * as prdMarkdownRoute from "@/app/api/prds/[id]/markdown/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as rejectStoryRoute from "@/app/api/stories/[id]/reject/route";
import * as traceabilityCsvRoute from "@/app/api/projects/[id]/traceability/csv/route";
import { setLLMClient } from "@/src/ai/llm-client";
import { apiKeyRepository } from "@/src/modules/api-keys/repository";
import { auditRepository } from "@/src/modules/audit/repository";
import { projectThroughGate2 } from "@/tests/helpers/backlog";
import { readState, transact } from "@/src/db/store";
import { DEMO_USER, type Session } from "@/src/lib/auth";
import { requestSurface } from "@/src/lib/auth-gate";
import { hashApiSecret } from "@/src/lib/api-key";
import { actAs } from "@/src/lib/test-session";
import { currentContext } from "@/src/modules/workspaces/service";
import { resetDb, validProject } from "@/tests/helpers/context";

const request = vi.hoisted(() => ({
  headers: null as Record<string, string> | null,
  session: undefined as Session | null | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!request.headers) throw new Error("`headers` was called outside a request scope");
    return new Headers(request.headers);
  },
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
// `undefined` = the normal demo session (and `actAs`); `null` = signed out, as a browser without a cookie.
vi.mock("@/src/lib/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/session")>();
  return {
    ...real,
    getSession: async () => (request.session === undefined ? real.getSession() : request.session),
  };
});

const DEV: Session = {
  userId: "00000000-0000-4000-8000-0000000000d3",
  name: "Dev",
  email: "dev@example.com",
};
const QA: Session = {
  userId: "00000000-0000-4000-8000-0000000000a4",
  name: "Quinn",
  email: "qa@example.com",
};
const SAME_401 = { error: { code: "UNAUTHORIZED", message: "Invalid API key" } };
const NO_APPROVE = "API keys can't approve or confirm; a person must do this";

/** Every `withKey` call simulates an API request; the surface comes from the proxy's own rule, never restated here. */
const API_PATH = "/api/test";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = (method: string, data?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
const plain = (method: string) => new Request("http://localhost/api/x", { method });
const bearer = (plaintext: string) => `Bearer ${plaintext}`;
const secretOf = (plaintext: string) => plaintext.split("_").slice(3).join("_");
const unknownId = () => crypto.randomUUID();

/** Runs `fn` as an API request carrying the key, the way `proxy.ts` hands it to the app. */
async function withKey<T>(
  plaintext: string,
  method: string,
  fn: () => Promise<T>,
  header = bearer(plaintext),
) {
  request.headers = {
    authorization: header,
    "x-pf-surface": requestSurface(API_PATH, method),
  };
  try {
    return await fn();
  } finally {
    request.headers = null;
  }
}

type Created = {
  key: { id: string; prefix: string; scope: string; expiresAt: string };
  plaintext: string;
};
async function mintKey(as: Session | null, input: unknown): Promise<Created> {
  actAs(as);
  try {
    const res = await keysRoute.POST(body("POST", input));
    expect(res.status).toBe(201);
    return (await res.json()) as Created;
  } finally {
    actAs(null);
  }
}

const addMember = (workspaceId: string, session: Session, role: "developer" | "qa" | "admin") =>
  transact((s) => {
    s.workspaceMembers.push({
      workspaceId,
      userId: session.userId,
      role,
      createdAt: new Date().toISOString(),
    });
  });

let workspaceId: string;
let projectId: string;

beforeEach(async () => {
  resetDb();
  request.headers = null;
  request.session = undefined;
  actAs(null);
  workspaceId = ((await (await workspaceRoute.GET()).json()) as { workspace: { id: string } })
    .workspace.id;
  await addMember(workspaceId, DEV, "developer");
  await addMember(workspaceId, QA, "qa");
  const created = await projectsRoute.POST(body("POST", validProject));
  projectId = ((await created.json()) as { project: { id: string } }).project.id;
});

afterEach(() => {
  actAs(null);
  request.headers = null;
  request.session = undefined;
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

describe("creating and using a key", () => {
  it("creates a key, authenticates with the plaintext, and reads a project", async () => {
    const res = await keysRoute.POST(body("POST", { name: "CI smoke tests", scope: "read" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const created = (await res.json()) as Created;
    expect(created.plaintext).toMatch(
      new RegExp(`^pf_test_${created.key.prefix}_[A-Za-z0-9_-]{43}$`),
    );
    expect(created.key).not.toHaveProperty("secretHash");

    const read = await withKey(created.plaintext, "GET", () =>
      projectRoute.GET(plain("GET"), params(projectId)),
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as { project: { name: string } }).project.name).toBe(
      validProject.name,
    );

    // It acts as the member who made it, named after the key's prefix.
    const who = await withKey(created.plaintext, "GET", () => workspaceRoute.GET());
    const me = (await who.json()) as { user: { name: string }; workspace: { id: string } };
    expect(me.user.name).toBe(`API key ${created.key.prefix}`);
    expect(me.workspace.id).toBe(workspaceId);
  });

  it("defaults the expiry to 90 days and refuses one the table would reject, as a 400 naming the field", async () => {
    const dflt = (await (
      await keysRoute.POST(body("POST", { name: "d", scope: "read" }))
    ).json()) as Created;
    expect(new Date(dflt.key.expiresAt).getTime() - Date.now()).toBeCloseTo(90 * 864e5, -4);

    const day = 864e5;
    for (const [expiresAt, why] of [
      [new Date(Date.now() + 400 * day).toISOString(), "too far"],
      [new Date(Date.now() + 367 * day).toISOString(), "just too far"],
      [new Date(Date.now() - day).toISOString(), "in the past"],
    ] as const) {
      const res = await keysRoute.POST(body("POST", { name: "x", scope: "read", expiresAt }));
      expect(res.status, why).toBe(400);
      const err = ((await res.json()) as { error: { code: string; details: { path: string }[] } })
        .error;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details[0]!.path).toBe("expiresAt");
    }
    const ok = await keysRoute.POST(
      body("POST", {
        name: "year",
        scope: "read",
        expiresAt: new Date(Date.now() + 365 * day).toISOString(),
      }),
    );
    expect(ok.status).toBe(201);
    expect((await keysRoute.POST(body("POST", { name: " ", scope: "admin" }))).status).toBe(400);
  });

  it("lists keys without the secret, and a member sees only their own while an owner sees all", async () => {
    const mine = await mintKey(null, { name: "owner key", scope: "read" });
    const devs = await mintKey(DEV, { name: "dev key", scope: "write" });

    const ownerList = await keysRoute.GET();
    const text = await ownerList.clone().text();
    expect(text).not.toContain("secretHash");
    expect(text).not.toContain(secretOf(mine.plaintext));
    expect(text).not.toContain(secretOf(devs.plaintext));
    expect(
      ((await ownerList.json()) as { keys: { id: string }[] }).keys.map((k) => k.id).sort(),
    ).toEqual([mine.key.id, devs.key.id].sort());

    actAs(DEV);
    const devList = (await (await keysRoute.GET()).json()) as { keys: { id: string }[] };
    expect(devList.keys.map((k) => k.id)).toEqual([devs.key.id]);
  });
});

describe("what a key may do", () => {
  it("refuses a read key on every write, though it may read", async () => {
    const { plaintext } = await mintKey(null, { name: "reader", scope: "read" });
    const attempts = [
      () =>
        sourcesRoute.POST(
          body("POST", { name: "Notes", text: "Customers can export data." }),
          params(projectId),
        ),
      () => projectRoute.PATCH(body("PATCH", { name: "Hijacked" }), params(projectId)),
      () => projectRoute.DELETE(plain("DELETE"), params(projectId)),
    ];
    for (const attempt of attempts) {
      const res = await withKey(plaintext, "POST", attempt);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
        "This API key is read-only",
      );
    }
    // Nothing changed, and a read still works.
    const read = await projectRoute.GET(plain("GET"), params(projectId));
    expect(((await read.json()) as { project: { name: string } }).project.name).toBe(
      validProject.name,
    );
    expect(
      (await withKey(plaintext, "GET", () => sourcesRoute.GET(plain("GET"), params(projectId))))
        .status,
    ).toBe(200);
  });

  it("lets a write key write, as its member, and the audit entry names the key", async () => {
    const { key, plaintext } = await mintKey(null, { name: "writer", scope: "write" });
    const res = await withKey(plaintext, "PATCH", () =>
      projectRoute.PATCH(body("PATCH", { name: "Renamed by a key" }), params(projectId)),
    );
    expect(res.status).toBe(200);
    const activity = (await (await activityRoute.GET(plain("GET"), params(projectId))).json()) as {
      activity: { action: string; actorId: string; actorName: string }[];
    };
    const entry = activity.activity.find((a) => a.action === "project.updated");
    expect(entry?.actorName).toBe(`API key ${key.prefix}`);
    expect(entry?.actorId).toBe(DEMO_USER.userId);
  });

  it("never gives a key a role its member lacks: a developer's write key is refused manager-only routes", async () => {
    const { plaintext } = await mintKey(DEV, { name: "dev writer", scope: "write" });
    const denied = await withKey(plaintext, "POST", () =>
      generatePrdRoute.POST(plain("POST"), params(projectId)),
    );
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { message: string } }).error.message).toContain(
      "Your role (developer)",
    );

    // What any member may do still works.
    const allowed = await withKey(plaintext, "POST", () =>
      sourcesRoute.POST(
        body("POST", { name: "Notes", text: "Customers can export their data." }),
        params(projectId),
      ),
    );
    expect(allowed.status).toBe(201);
  });

  it("refuses an owner's key on every approve and confirm route, while the owner's own session is not refused", async () => {
    const { plaintext } = await mintKey(null, { name: "owner writer", scope: "write" });
    const routes: [string, () => Promise<Response>][] = [
      [
        "POST /api/prds/[id]/approve",
        () => approvePrdRoute.POST(plain("POST"), params(unknownId())),
      ],
      [
        "POST /api/stories/[id]/approve",
        () => approveStoryRoute.POST(plain("POST"), params(unknownId())),
      ],
      [
        "POST /api/projects/[id]/backlog/approve",
        () => approveBacklogRoute.POST(plain("POST"), params(projectId)),
      ],
      [
        "POST /api/projects/[id]/discovery/confirm",
        () => confirmDiscoveryRoute.POST(plain("POST"), params(projectId)),
      ],
      [
        "POST /api/changes/[id]/approve",
        () => approveChangeRoute.POST(plain("POST"), params(unknownId())),
      ],
    ];
    for (const [name, call] of routes) {
      const viaKey = await withKey(plaintext, "POST", call);
      expect(viaKey.status, name).toBe(403);
      expect(((await viaKey.json()) as { error: { message: string } }).error.message, name).toBe(
        NO_APPROVE,
      );
      // The same owner, signed in: the refusal is the key's, not the role's.
      const viaSession = await call();
      expect(viaSession.status, `${name} (session)`).not.toBe(403);
    }
  });

  it("can't create or revoke keys, so a leaked key can't extend or end its own life", async () => {
    const { key, plaintext } = await mintKey(null, { name: "writer", scope: "write" });
    const create = await withKey(plaintext, "POST", () =>
      keysRoute.POST(body("POST", { name: "more", scope: "write" })),
    );
    expect(create.status).toBe(403);
    const revoke = await withKey(plaintext, "DELETE", () =>
      keyRoute.DELETE(plain("DELETE"), params(key.id)),
    );
    expect(revoke.status).toBe(403);
    expect((await withKey(plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
  });
});

describe("last use", () => {
  const lastUsed = async (id: string) =>
    (
      (await (await keysRoute.GET()).json()) as {
        keys: { id: string; lastUsedAt: string | null }[];
      }
    ).keys.find((k) => k.id === id)!.lastUsedAt;

  it("is recorded on a successful use", async () => {
    const { key, plaintext } = await mintKey(null, { name: "used", scope: "read" });
    expect(await lastUsed(key.id)).toBeNull();
    expect((await withKey(plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
    expect(await lastUsed(key.id)).not.toBeNull();
  });

  it("is recorded even when a read key is refused a write, so a leak leaves a trace", async () => {
    const { key, plaintext } = await mintKey(null, { name: "refused", scope: "read" });
    const res = await withKey(plaintext, "POST", () =>
      keysRoute.POST(body("POST", { name: "x", scope: "read" })),
    );
    expect(res.status).toBe(403);
    expect(await lastUsed(key.id)).not.toBeNull();
  });

  it("failing to record it never fails the request", async () => {
    const { plaintext } = await mintKey(null, { name: "flaky", scope: "read" });
    const touch = vi
      .spyOn(apiKeyRepository, "touchLastUsed")
      .mockRejectedValue(new Error("db down"));
    const res = await withKey(plaintext, "GET", () => workspaceRoute.GET());
    expect(touch).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });
});

describe("first use", () => {
  const firstUses = async (id: string) =>
    (await readState()).auditLogs.filter(
      (l) => l.action === "api_key.first_used" && l.entityId === id,
    );

  it("writes one audit entry, as the key's member, on the first use and none on the second", async () => {
    const { key, plaintext } = await mintKey(null, { name: "first", scope: "read" });
    expect(await firstUses(key.id)).toHaveLength(0);

    expect((await withKey(plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
    const [entry, ...rest] = await firstUses(key.id);
    expect(rest).toHaveLength(0);
    expect(entry!.workspaceId).toBe(workspaceId);
    expect(entry!.actorId).toBe(DEMO_USER.userId);
    expect(entry!.actorName).toBe(`API key ${key.prefix}`);
    expect(JSON.stringify(entry)).not.toContain(secretOf(plaintext));

    expect((await withKey(plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
    expect(await firstUses(key.id)).toHaveLength(1);
  });

  it("is written even when the first use is a read key refused a write", async () => {
    const { key, plaintext } = await mintKey(null, { name: "first refused", scope: "read" });
    const res = await withKey(plaintext, "POST", () =>
      keysRoute.POST(body("POST", { name: "x", scope: "read" })),
    );
    expect(res.status).toBe(403);
    expect(await firstUses(key.id)).toHaveLength(1);
  });

  it("failing to write it never fails the request", async () => {
    const { key, plaintext } = await mintKey(null, { name: "flaky audit", scope: "read" });
    const insert = vi
      .spyOn(auditRepository, "insert")
      .mockRejectedValue(new Error("audit table down"));
    const res = await withKey(plaintext, "GET", () => workspaceRoute.GET());
    expect(insert).toHaveBeenCalled();
    expect(res.status).toBe(200);
    insert.mockRestore();
    expect(await firstUses(key.id)).toHaveLength(0);
  });
});

describe("exports are reads (they may append an audit row)", () => {
  it("lets a read key GET and HEAD the PRD, backlog and traceability exports, and the audit row lands", async () => {
    const { projectId } = await projectThroughGate2();
    const prd = (await (await prdStateRoute.GET(plain("GET"), params(projectId))).json()) as {
      versions: { id: string }[];
    };
    const exports: [string, (method: string) => Promise<Response>][] = [
      ["prd", (m) => prdMarkdownRoute.GET(plain(m), params(prd.versions[0]!.id))],
      ["backlog", (m) => backlogMarkdownRoute.GET(plain(m), params(projectId))],
      ["traceability", (m) => traceabilityCsvRoute.GET(plain(m), params(projectId))],
    ];
    const { key, plaintext } = await mintKey(null, { name: "CI pull", scope: "read" });
    const exported = async () =>
      (await readState()).auditLogs.filter((l) => l.action.endsWith(".exported"));
    const before = (await exported()).length;

    for (const [name, call] of exports)
      for (const method of ["GET", "HEAD"]) {
        const res = await withKey(plaintext, method, () => call(method));
        expect(res.status, `${method} ${name}`).toBe(200);
      }

    const added = (await exported()).slice(before);
    expect(added.map((l) => l.action).sort()).toEqual([
      "backlog.exported",
      "backlog.exported",
      "prd.exported",
      "prd.exported",
      "traceability.exported",
      "traceability.exported",
    ]);
    for (const entry of added) {
      expect(entry.actorName).toBe(`API key ${key.prefix}`);
      expect(entry.actorId).toBe(DEMO_USER.userId);
    }
  });
});

describe("a key can't approve an epic by rejecting its last unapproved story", () => {
  const epicStatus = async (id: string) =>
    (await readState()).epics.find((e) => e.id === id)!.status;
  const storyStatus = async (id: string) =>
    (await readState()).stories.find((s) => s.id === id)!.status;

  it("is refused, and the story, the epic and the audit log are untouched; a person's rejection still works", async () => {
    setLLMClient(undefined);
    process.env.AI_RUNS_PER_USER_PER_MINUTE = "1000";
    try {
      const { projectId } = await projectThroughGate2();
      await generateBacklogRoute.POST(plain("POST"), params(projectId));
      const backlog = (await (await backlogRoute.GET(plain("GET"), params(projectId))).json()) as {
        stories: { id: string; epicId: string }[];
      };
      const byEpic = Map.groupBy(backlog.stories, (s) => s.epicId);
      const [epicId, stories] = [...byEpic].sort((a, b) => b[1].length - a[1].length)[0]!;
      expect(stories.length).toBeGreaterThanOrEqual(2);
      const last = stories.at(-1)!;
      // The exact state: every story in the epic approved except `last`; the epic itself still a draft.
      await transact((s) => {
        for (const story of s.stories)
          if (story.epicId === epicId) story.status = story.id === last.id ? "DRAFT" : "APPROVED";
        s.epics.find((e) => e.id === epicId)!.status = "DRAFT";
      });
      const { plaintext } = await mintKey(null, { name: "writer", scope: "write" });
      const reject = (id: string) =>
        rejectStoryRoute.POST(body("POST", { reason: "Not what we meant" }), params(id));

      const viaKey = await withKey(plaintext, "POST", () => reject(last.id));
      expect(viaKey.status).toBe(403);
      expect(((await viaKey.json()) as { error: { message: string } }).error.message).toBe(
        NO_APPROVE,
      );
      expect(await storyStatus(last.id)).toBe("DRAFT");
      expect(await epicStatus(epicId)).toBe("DRAFT");
      expect((await readState()).auditLogs.some((l) => l.action === "story.rejected")).toBe(false);

      // A key may still reject a story that does not complete its epic.
      const first = stories[0]!;
      await transact((s) => void (s.stories.find((x) => x.id === first.id)!.status = "DRAFT"));
      const harmless = await withKey(plaintext, "POST", () => reject(first.id));
      expect(harmless.status).toBe(200);
      expect(await epicStatus(epicId)).toBe("DRAFT");

      // The same rejection by a person is allowed, and now the epic is approved, as before.
      await transact((s) => void (s.stories.find((x) => x.id === first.id)!.status = "APPROVED"));
      expect((await reject(last.id)).status).toBe(200);
      expect(await epicStatus(epicId)).toBe("APPROVED");
    } finally {
      delete process.env.AI_RUNS_PER_USER_PER_MINUTE;
    }
  });
});

describe("a key that must not work", () => {
  it("answers a caller who holds nothing (malformed, unknown prefix, wrong secret) with one byte-identical 401", async () => {
    const live = await mintKey(null, { name: "live", scope: "write" });
    const wrongSecret =
      live.plaintext.slice(0, -3) + (live.plaintext.endsWith("AAA") ? "BBB" : "AAA");
    const unknownPrefix = live.plaintext.replace(
      live.key.prefix,
      live.key.prefix === "aaaaaaaa" ? "bbbbbbbb" : "aaaaaaaa",
    );
    const attempts: [string, string][] = [
      ["wrong secret", bearer(wrongSecret)],
      ["unknown prefix", bearer(unknownPrefix)],
      ["malformed", "Bearer pf_live_nonsense"],
      ["truncated", bearer(live.plaintext.slice(0, 30))],
    ];
    const texts: string[] = [];
    for (const [why, header] of attempts) {
      const res = await withKey("", "GET", () => workspaceRoute.GET(), header);
      expect(res.status, why).toBe(401);
      const text = await res.text();
      expect(JSON.parse(text), why).toEqual(SAME_401);
      texts.push(text);
    }
    // The property a careless edit would break: nothing before the secret matches tells them apart.
    expect(new Set(texts).size).toBe(1);
    // And the live key still works, so the refusals above weren't a blanket failure.
    expect((await withKey(live.plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
  });

  it("says why a key that has proved its secret is refused: revoked, expired, member removed", async () => {
    const revoked = await mintKey(null, { name: "revoked", scope: "write" });
    const expired = await mintKey(null, { name: "expired", scope: "write" });
    const removed = await mintKey(DEV, { name: "removed", scope: "write" });

    expect((await keyRoute.DELETE(plain("DELETE"), params(revoked.key.id))).status).toBe(200);
    const expiredAt = new Date(Date.now() - 2 * 864e5).toISOString();
    await transact((s) => {
      s.apiKeys.find((k) => k.id === expired.key.id)!.expiresAt = expiredAt;
      s.workspaceMembers = s.workspaceMembers.filter((m) => m.userId !== DEV.userId);
    });

    const expected: [string, Created, string][] = [
      ["revoked", revoked, "This API key was revoked."],
      ["expired", expired, `This API key expired on ${expiredAt.slice(0, 10)}.`],
      ["member removed", removed, "The member this key belongs to is no longer in this workspace."],
    ];
    const messages = new Set<string>();
    for (const [why, created, message] of expected) {
      const res = await withKey(created.plaintext, "GET", () => workspaceRoute.GET());
      expect(res.status, why).toBe(401);
      expect(await res.json(), why).toEqual({ error: { code: "UNAUTHORIZED", message } });
      messages.add(message);
    }
    expect(messages.size).toBe(3);
    for (const message of messages) expect(message).not.toBe(SAME_401.error.message);
  });

  it("never falls back to the browser session when a key is presented on /api", async () => {
    // The demo session is signed in, yet a bad key is a 401, not the cookie user's data.
    const res = await withKey(
      "",
      "GET",
      () => projectsRoute.GET(),
      `Bearer pf_live_abcdefgh_${"A".repeat(43)}`,
    );
    expect(res.status).toBe(401);
  });

  it("is refused on a dashboard page: the key is ignored there and the normal sign-in applies", async () => {
    const { plaintext } = await mintKey(DEV, { name: "dev reader", scope: "read" });
    request.headers = { authorization: bearer(plaintext), "x-pf-surface": "page" };

    request.session = null; // no cookie
    await expect(currentContext()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Please sign in",
    });

    request.session = undefined; // a signed-in browser: still the browser's user, never the key's
    const ctx = await currentContext();
    expect(ctx.viaApiKey).toBeUndefined();
    expect(ctx.session.userId).toBe(DEMO_USER.userId);
    expect(ctx.session.name).not.toMatch(/^API key/);

    // A key with no surface header at all (the proxy didn't run) is not honoured either.
    request.headers = { authorization: bearer(plaintext) };
    request.session = null;
    await expect(currentContext()).rejects.toMatchObject({ message: "Please sign in" });
  });

  it("is only a key's context when the request really is an API request", async () => {
    const { plaintext } = await mintKey(DEV, { name: "dev writer", scope: "write" });
    request.headers = {
      authorization: bearer(plaintext),
      "x-pf-surface": requestSurface(API_PATH, "POST"),
    };
    const ctx = await currentContext();
    expect(ctx.viaApiKey).toBe(true);
    expect(ctx.session.userId).toBe(DEV.userId);
    expect(ctx.role).toBe("developer");
  });
});

describe("revoking", () => {
  it("lets a member revoke their own key, an admin or owner revoke anyone's, and no one revoke another member's", async () => {
    const devKey = await mintKey(DEV, { name: "dev key", scope: "write" });
    const ownerKey = await mintKey(null, { name: "owner key", scope: "write" });

    actAs(QA);
    expect((await keyRoute.DELETE(plain("DELETE"), params(devKey.key.id))).status).toBe(404);
    actAs(DEV);
    expect((await keyRoute.DELETE(plain("DELETE"), params(ownerKey.key.id))).status).toBe(404);

    actAs(null); // the owner
    const revoked = await keyRoute.DELETE(plain("DELETE"), params(devKey.key.id));
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { key: { revokedAt: string } }).key.revokedAt).toBeTruthy();
    expect((await withKey(devKey.plaintext, "GET", () => workspaceRoute.GET())).status).toBe(401);
    expect((await withKey(ownerKey.plaintext, "GET", () => workspaceRoute.GET())).status).toBe(200);
  });

  it("is idempotent: a second revoke returns the key unchanged and writes no second audit entry", async () => {
    const { key } = await mintKey(null, { name: "once", scope: "read" });
    const first = (await (await keyRoute.DELETE(plain("DELETE"), params(key.id))).json()) as {
      key: { revokedAt: string };
    };
    const second = await keyRoute.DELETE(plain("DELETE"), params(key.id));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { key: { revokedAt: string } }).key.revokedAt).toBe(
      first.key.revokedAt,
    );
    const audits = (await readState()).auditLogs.filter(
      (l) => l.action === "api_key.revoked" && l.entityId === key.id,
    );
    expect(audits).toHaveLength(1);
  });

  it("answers 404 for a key that doesn't exist", async () => {
    expect((await keyRoute.DELETE(plain("DELETE"), params(unknownId()))).status).toBe(404);
    expect((await keyRoute.DELETE(plain("DELETE"), params("not-a-uuid"))).status).toBe(404);
  });
});

describe("secrets stay secret", () => {
  it("never writes the plaintext to the store, the audit log or a log line, and stores only the SHA-256", async () => {
    process.env.LOG_LEVEL = "debug";
    const lines: string[] = [];
    for (const method of ["log", "warn", "error", "info", "debug"] as const)
      vi.spyOn(console, method).mockImplementation(
        (...args: unknown[]) => void lines.push(args.map(String).join(" ")),
      );

    const { key, plaintext } = await mintKey(null, { name: "secretive", scope: "write" });
    const secret = secretOf(plaintext);
    await withKey(plaintext, "GET", () => workspaceRoute.GET()); // success
    await withKey(plaintext, "POST", () =>
      keysRoute.POST(body("POST", { name: "x", scope: "read" })),
    ); // refused
    await withKey("", "GET", () => workspaceRoute.GET(), bearer(plaintext.slice(0, -2) + "AA")); // wrong secret
    await withKey("", "GET", () => workspaceRoute.GET(), bearer(plaintext) + "x"); // malformed
    await keyRoute.DELETE(plain("DELETE"), params(key.id));
    await withKey(plaintext, "GET", () => workspaceRoute.GET()); // revoked

    const rejections = lines.filter((l) => l.includes("API key rejected"));
    expect(rejections.length).toBeGreaterThanOrEqual(3); // the test is not vacuous
    expect(rejections.some((l) => l.includes(key.prefix))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(secret);
      expect(line).not.toContain(plaintext);
    }

    const state = await readState();
    const stored = state.apiKeys.find((k) => k.id === key.id)!;
    expect(stored.secretHash).toBe(hashApiSecret(secret));
    expect(JSON.stringify(state.auditLogs)).not.toContain(secret);
    expect(JSON.stringify(state.auditLogs)).not.toContain(stored.secretHash);
    expect(JSON.stringify({ ...state, apiKeys: [] })).not.toContain(secret);
    expect(JSON.stringify(state.apiKeys)).not.toContain(secret);
  });
});
