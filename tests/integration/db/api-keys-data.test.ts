/**
 * API keys in Postgres (PF-083, ADR-036): the `api_keys` table's row-level security and the
 * repository, on PGlite with the real migrations. Each refusal is asserted as the policy's (42501)
 * or the constraint's own code, and the same statement run by an allowed user succeeds first, so a
 * refusal can't come from a mistake in the statement itself (see rls-writes.test.ts).
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbSession } from "@/src/db/client";
import { apiKeys } from "@/src/db/schema";
import { setUserRunner, type UserRunner, type WorkspaceScope } from "@/src/db/scope";
import { readState, transact } from "@/src/db/store";
import { newId } from "@/src/lib/ids";
import { apiKeyRepository } from "@/src/modules/api-keys/repository";
import type { ApiKey, NewApiKey } from "@/src/modules/api-keys/schema";

import {
  createRlsDb,
  expectPgCode,
  expectRlsRefusal,
  type RlsHarness,
  USERS,
  WS,
} from "./rls-harness";

// The verify-path methods use adminDb(); point it at the PGlite database (the table owner there).
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/db/client")>()),
  adminDb: () => holder.db,
}));

let h: RlsHarness;

const scopeOf = (userId: string, workspaceId: string, name = "Someone"): WorkspaceScope => ({
  session: { userId, name, email: `${name.toLowerCase()}@example.com` },
  workspace: { id: workspaceId },
});

let n = 0;
const base32 = "abcdefghijklmnopqrstuvwxyz234567";
/** A unique, well-formed prefix per key. */
const nextPrefix = () => {
  n += 1;
  // n written in base 32 across all eight characters: distinct for every n below 32^8.
  return Array.from({ length: 8 }, (_, i) => base32[Math.floor(n / 32 ** i) % 32]).join("");
};

const keyFor = (userId: string, workspaceId: string, over: Partial<NewApiKey> = {}): NewApiKey => ({
  id: newId(),
  workspaceId,
  userId,
  name: "CI smoke tests",
  prefix: nextPrefix(),
  scope: "read",
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
  revokedAt: null,
  secretHash: "a".repeat(64),
  ...over,
});

/** The same row as a raw insert statement, for the tests that need Postgres's own error. */
const values = (k: NewApiKey) => ({
  ...k,
  createdAt: new Date(k.createdAt),
  lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
  expiresAt: new Date(k.expiresAt),
  revokedAt: k.revokedAt ? new Date(k.revokedAt) : null,
});
const insertRaw = (as: string, k: NewApiKey) =>
  h.as(as, (tx) => tx.insert(apiKeys).values(values(k)));
/** Seeds as the table owner (no RLS), the way a system job would. */
const seedKey = (k: NewApiKey) => h.db.insert(apiKeys).values(values(k));
const rowOf = async (id: string) =>
  (await h.db.select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
const visibleTo = async (userId: string) =>
  (await h.as(userId, (tx) => tx.select({ id: apiKeys.id }).from(apiKeys))).map((r) => r.id);

beforeAll(async () => {
  h = await createRlsDb();
  holder.db = h.db;
  setUserRunner(((session: DbSession, fn: never) =>
    h.as(session.userId, fn)) as unknown as UserRunner);
}, 60_000);

afterAll(async () => {
  setUserRunner(null);
  vi.unstubAllEnvs();
  await h?.pg.close();
});

beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

describe("who sees which keys (select policy)", () => {
  const devKey = keyFor(USERS.dev, WS.ana, { name: "Dev's key" });
  const pamKey = keyFor(USERS.pam, WS.ana, { name: "Pam's key" });

  it("lets a member insert and list their own key, without the hash", async () => {
    const dev = scopeOf(USERS.dev, WS.ana, "Dev");
    const stored = await apiKeyRepository.insert(dev, devKey);
    expect(stored).toMatchObject({ id: devKey.id, userId: USERS.dev, scope: "read" });
    expect(stored).not.toHaveProperty("secretHash");

    const mine = await apiKeyRepository.listForUser(dev, USERS.dev);
    expect(mine.map((k) => k.id)).toEqual([devKey.id]);
    expect(mine[0]).not.toHaveProperty("secretHash");
    // The hash is in the row, so the absence above is the mapping's doing, not the table's.
    expect((await rowOf(devKey.id))?.secretHash).toBe(devKey.secretHash);
  });

  it("hides one member's key from another member", async () => {
    await apiKeyRepository.insert(scopeOf(USERS.pam, WS.ana, "Pam"), pamKey);
    // Pam asks for everything in the workspace and gets only her own.
    const pamSees = await apiKeyRepository.listForWorkspace(scopeOf(USERS.pam, WS.ana, "Pam"));
    expect(pamSees.map((k) => k.id)).toEqual([pamKey.id]);
    // Dev asks for Pam's keys by user id and gets none.
    expect(
      await apiKeyRepository.listForUser(scopeOf(USERS.dev, WS.ana, "Dev"), USERS.pam),
    ).toEqual([]);
    expect(await visibleTo(USERS.dev)).not.toContain(pamKey.id);
  });

  it("shows the owner and an admin every key in the workspace", async () => {
    for (const user of [USERS.ana, USERS.adi]) {
      const all = await apiKeyRepository.listForWorkspace(scopeOf(user, WS.ana));
      expect(all.map((k) => k.id).sort()).toEqual([devKey.id, pamKey.id].sort());
    }
  });

  it("shows another workspace's owner none of them", async () => {
    expect(await apiKeyRepository.listForWorkspace(scopeOf(USERS.ben, WS.ana, "Ben"))).toEqual([]);
    expect(
      await apiKeyRepository.listForUser(scopeOf(USERS.ben, WS.ana, "Ben"), USERS.dev),
    ).toEqual([]);
    expect(await visibleTo(USERS.ben)).toEqual([]);
    expect(await visibleTo(USERS.ana)).toHaveLength(2); // the rows exist; Ben just can't see them
  });
});

describe("who can insert (insert policy and foreign key)", () => {
  it("refuses a member of another workspace inserting into this one", async () => {
    // Same statement, allowed user: Ana inserts a key for herself.
    await insertRaw(USERS.ana, keyFor(USERS.ana, WS.ana));
    await expectRlsRefusal(insertRaw(USERS.ben, keyFor(USERS.ben, WS.ana)));
  });

  it("refuses inserting a key for someone else, even an admin doing it", async () => {
    await insertRaw(USERS.dev, keyFor(USERS.dev, WS.ana)); // for themselves: fine
    await expectRlsRefusal(insertRaw(USERS.dev, keyFor(USERS.pam, WS.ana)));
    await expectRlsRefusal(insertRaw(USERS.adi, keyFor(USERS.dev, WS.ana)));
  });

  it("maps the refusal to FORBIDDEN through the repository", async () => {
    await expectRlsRefusal(
      apiKeyRepository.insert(scopeOf(USERS.ben, WS.ana, "Ben"), keyFor(USERS.ben, WS.ana)),
    );
  });

  it("ties a key to a member of its own workspace (composite foreign key)", async () => {
    // As the owner, so RLS is out of the way and only the constraint can speak.
    await seedKey(keyFor(USERS.ana, WS.ana)); // Ana is a member of A: fine
    await expectPgCode(seedKey(keyFor(USERS.ana, WS.ben)), "23503"); // not a member of B
    await expectPgCode(seedKey(keyFor(USERS.dev, WS.ben)), "23503");
  });

  it("keeps the prefix unique across the whole table", async () => {
    const first = keyFor(USERS.dev, WS.ana);
    await seedKey(first);
    await expectPgCode(seedKey(keyFor(USERS.pam, WS.ana, { prefix: first.prefix })), "23505");
    await expect(
      apiKeyRepository.insert(
        scopeOf(USERS.pam, WS.ana, "Pam"),
        keyFor(USERS.pam, WS.ana, { prefix: first.prefix }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a scope outside read/write", async () => {
    await expectPgCode(
      seedKey(keyFor(USERS.dev, WS.ana, { scope: "approve" as unknown as "read" })),
      "23514",
    );
  });
});

describe("the table refuses malformed rows itself (check constraints)", () => {
  it("accepts a well-formed key, then refuses a bad prefix, hash or expiry window", async () => {
    await seedKey(keyFor(USERS.dev, WS.ana)); // control: the same shape, well formed
    await expectPgCode(seedKey(keyFor(USERS.dev, WS.ana, { prefix: "ABCDEFGH" })), "23514");
    await expectPgCode(seedKey(keyFor(USERS.dev, WS.ana, { prefix: "abc1defg" })), "23514");
    await expectPgCode(seedKey(keyFor(USERS.dev, WS.ana, { secretHash: "not-a-hash" })), "23514");
    const created = Date.now();
    const at = (days: number) => new Date(created + days * 864e5).toISOString();
    await expectPgCode(
      seedKey(keyFor(USERS.dev, WS.ana, { createdAt: at(0), expiresAt: at(-1) })),
      "23514",
    );
    await expectPgCode(
      seedKey(keyFor(USERS.dev, WS.ana, { createdAt: at(0), expiresAt: at(400) })),
      "23514",
    );
  });
});

describe("deleting, updating and revoking", () => {
  it("refuses every delete, the owner's included, and the row survives", async () => {
    const key = keyFor(USERS.dev, WS.ana);
    await seedKey(key);
    for (const user of [USERS.dev, USERS.ana, USERS.adi])
      await expectRlsRefusal(h.as(user, (tx) => tx.delete(apiKeys).where(eq(apiKeys.id, key.id))));
    expect(await rowOf(key.id)).toBeDefined();
  });

  it("lets the owner of a key revoke it, and revoking twice keeps the first time", async () => {
    const key = keyFor(USERS.dev, WS.ana);
    await seedKey(key);
    const dev = scopeOf(USERS.dev, WS.ana, "Dev");
    const first = await apiKeyRepository.revoke(dev, key.id, "2026-11-23T10:00:00.000Z");
    expect(first.revokedAt).toBe("2026-11-23T10:00:00.000Z");
    expect((await rowOf(key.id))?.revokedAt?.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    const again = await apiKeyRepository.revoke(dev, key.id, "2026-11-24T10:00:00.000Z");
    expect(again.revokedAt).toBe("2026-11-23T10:00:00.000Z");
  });

  it("lets an admin revoke a teammate's key, but not another member or another workspace", async () => {
    const key = keyFor(USERS.dev, WS.ana);
    await seedKey(key);
    // Pam is a member but neither the key's owner nor an admin: the key is invisible to her.
    await expect(
      apiKeyRepository.revoke(scopeOf(USERS.pam, WS.ana, "Pam"), key.id, new Date().toISOString()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      apiKeyRepository.revoke(scopeOf(USERS.ben, WS.ana, "Ben"), key.id, new Date().toISOString()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await rowOf(key.id))?.revokedAt).toBeNull();

    const revoked = await apiKeyRepository.revoke(
      scopeOf(USERS.adi, WS.ana, "Adi"),
      key.id,
      "2026-11-23T11:00:00.000Z",
    );
    expect(revoked.revokedAt).toBe("2026-11-23T11:00:00.000Z");
  });

  it("changes nothing but revoked_at and last_used_at", async () => {
    const key = keyFor(USERS.dev, WS.ana);
    await seedKey(key);
    // Allowed: the same statement shape on last_used_at.
    await h.as(USERS.dev, (tx) =>
      tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)),
    );
    expect((await rowOf(key.id))?.lastUsedAt).not.toBeNull();
    // Refused: the secret, the scope, the expiry and the owner stay as minted.
    for (const patch of [
      { secretHash: "b".repeat(64) },
      { scope: "write" },
      { expiresAt: new Date(Date.now() + 3650 * 864e5) },
      { userId: USERS.pam },
    ])
      await expectRlsRefusal(
        h.as(USERS.dev, (tx) => tx.update(apiKeys).set(patch).where(eq(apiKeys.id, key.id))),
      );
    expect(await rowOf(key.id)).toMatchObject({ scope: "read", secretHash: key.secretHash });
  });

  it("never brings a revoked key back", async () => {
    const key = keyFor(USERS.dev, WS.ana, { revokedAt: "2026-11-01T00:00:00.000Z" });
    await seedKey(key);
    const revived = await h.as(USERS.ana, (tx) =>
      tx.update(apiKeys).set({ revokedAt: null }).where(eq(apiKeys.id, key.id)).returning(),
    );
    expect(revived).toEqual([]); // the policy hides a revoked row from UPDATE
    expect((await rowOf(key.id))?.revokedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("destroys a member's keys when the member is removed", async () => {
    const key = keyFor(USERS.pam, WS.ana);
    await seedKey(key);
    await h.pg.query("delete from workspace_members where workspace_id = $1 and user_id = $2", [
      WS.ana,
      USERS.pam,
    ]);
    expect(await rowOf(key.id)).toBeUndefined();
    await h.pg.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'pm')",
      [WS.ana, USERS.pam],
    );
  });
});

describe("the verify path (admin client)", () => {
  it("finds a key by prefix with its hash and the columns verification needs", async () => {
    const key = keyFor(USERS.dev, WS.ana, { revokedAt: "2026-11-01T00:00:00.000Z" });
    await seedKey(key);
    const found = await apiKeyRepository.findByPrefix(key.prefix);
    expect(found).toEqual({
      id: key.id,
      workspaceId: WS.ana,
      userId: USERS.dev,
      prefix: key.prefix,
      scope: "read",
      secretHash: key.secretHash,
      expiresAt: key.expiresAt,
      revokedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(await apiKeyRepository.findByPrefix("zzzzzzzz")).toBeNull();
  });

  it("records last use", async () => {
    const key = keyFor(USERS.dev, WS.ana);
    await seedKey(key);
    await apiKeyRepository.touchLastUsed(key.id, "2026-11-23T12:00:00.000Z");
    expect((await rowOf(key.id))?.lastUsedAt?.toISOString()).toBe("2026-11-23T12:00:00.000Z");
  });
});

describe("the demo store backend", () => {
  // The memory store lives for the whole process, so each test starts from an empty one and seeds
  // the members it needs; no test may lean on what an earlier one left behind.
  beforeEach(async () => {
    vi.stubEnv("DATA_DRIVER", "memory");
    vi.stubEnv("AUTH_DRIVER", "demo");
    await transact((state) => {
      state.apiKeys.length = 0;
      state.workspaceMembers.length = 0;
    });
  });

  it("round-trips the same calls", async () => {
    const member = {
      workspaceId: WS.ana,
      userId: USERS.dev,
      role: "developer" as const,
      createdAt: new Date().toISOString(),
    };
    await transact((state) => void state.workspaceMembers.push(member));
    const dev = scopeOf(USERS.dev, WS.ana, "Dev");
    const key = keyFor(USERS.dev, WS.ana);

    const stored = await apiKeyRepository.insert(dev, key);
    expect(stored).not.toHaveProperty("secretHash");
    expect((await apiKeyRepository.listForUser(dev, USERS.dev)).map((k) => k.id)).toEqual([key.id]);
    expect(
      await apiKeyRepository.listForUser(scopeOf(USERS.ben, WS.ben, "Ben"), USERS.dev),
    ).toEqual([]);
    expect((await apiKeyRepository.findByPrefix(key.prefix))?.secretHash).toBe(key.secretHash);

    await apiKeyRepository.touchLastUsed(key.id, "2026-11-23T12:00:00.000Z");
    const revoked = await apiKeyRepository.revoke(dev, key.id, "2026-11-23T13:00:00.000Z");
    expect(revoked).toMatchObject({
      lastUsedAt: "2026-11-23T12:00:00.000Z",
      revokedAt: "2026-11-23T13:00:00.000Z",
    });
    expect((await readState()).apiKeys).toHaveLength(1);
    // The store keeps the foreign key's promise: a key for a non-member is refused.
    await expect(
      apiKeyRepository.insert(scopeOf(USERS.ben, WS.ana, "Ben"), keyFor(USERS.ben, WS.ana)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  const addMember = (userId: string, role: "owner" | "admin" | "pm" | "developer") =>
    transact((state) => {
      if (!state.workspaceMembers.some((m) => m.workspaceId === WS.ana && m.userId === userId))
        state.workspaceMembers.push({
          workspaceId: WS.ana,
          userId,
          role,
          createdAt: new Date().toISOString(),
        });
    });

  it("shows a member only their own keys, and owners and admins all of them (select policy)", async () => {
    await addMember(USERS.ana, "owner");
    await addMember(USERS.adi, "admin");
    await addMember(USERS.dev, "developer");
    await addMember(USERS.pam, "pm");
    const devKey = keyFor(USERS.dev, WS.ana);
    const pamKey = keyFor(USERS.pam, WS.ana);
    await apiKeyRepository.insert(scopeOf(USERS.dev, WS.ana, "Dev"), devKey);
    await apiKeyRepository.insert(scopeOf(USERS.pam, WS.ana, "Pam"), pamKey);

    const ids = async (user: string, name: string) =>
      (await apiKeyRepository.listForWorkspace(scopeOf(user, WS.ana, name))).map((k) => k.id);
    expect(await ids(USERS.dev, "Dev")).toEqual([devKey.id]);
    expect(
      await apiKeyRepository.listForUser(scopeOf(USERS.dev, WS.ana, "Dev"), USERS.pam),
    ).toEqual([]);
    for (const [user, name] of [
      [USERS.ana, "Ana"],
      [USERS.adi, "Adi"],
    ] as const)
      expect(await ids(user, name)).toEqual(expect.arrayContaining([devKey.id, pamKey.id]));
    expect(
      (await apiKeyRepository.listForUser(scopeOf(USERS.adi, WS.ana, "Adi"), USERS.pam)).map(
        (k) => k.id,
      ),
    ).toEqual([pamKey.id]);
  });

  it("lets only the key's owner or an admin revoke it (update policy)", async () => {
    await addMember(USERS.adi, "admin");
    await addMember(USERS.dev, "developer");
    await addMember(USERS.pam, "pm");
    const key = keyFor(USERS.dev, WS.ana);
    await apiKeyRepository.insert(scopeOf(USERS.dev, WS.ana, "Dev"), key);
    const at = "2026-11-23T14:00:00.000Z";

    await expect(
      apiKeyRepository.revoke(scopeOf(USERS.pam, WS.ana, "Pam"), key.id, at),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await readState()).apiKeys.find((k) => k.id === key.id)?.revokedAt).toBeNull();

    const byAdmin = await apiKeyRepository.revoke(scopeOf(USERS.adi, WS.ana, "Adi"), key.id, at);
    expect(byAdmin.revokedAt).toBe(at);
  });

  it("refuses to hand a hash-carrying key out as an ApiKey (compile-time)", () => {
    const stored = keyFor(USERS.dev, WS.ana);
    // @ts-expect-error a NewApiKey carries secretHash, so it is not an ApiKey
    const leaked: ApiKey = stored;
    expect(leaked).toBeDefined();
  });
});
