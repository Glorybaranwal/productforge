/**
 * Roles inside a workspace (PF-012, ADR-020): owners and admins manage members, but nobody promotes
 * themselves to owner, demotes or removes an owner, or hands the workspace to someone else. The
 * membership checks run in security-definer functions in `private`, which outsiders can't call.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workspaceMembers, workspaces } from "@/src/db/schema";

import { createRlsDb, failure, type RlsHarness, USERS, WS } from "./rls-harness";

let h: RlsHarness;

beforeAll(async () => {
  h = await createRlsDb();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

/** The user's membership of Ana's team. */
const inAnasTeam = (userId: string) =>
  and(eq(workspaceMembers.workspaceId, WS.ana), eq(workspaceMembers.userId, userId));
const join = (userId: string, role: "owner" | "admin" | "qa") => ({
  workspaceId: WS.ana,
  userId,
  role,
});

describe("managing members (PF-012)", () => {
  it("owners and admins add members; developers can't; anyone can leave", async () => {
    expect(
      await failure(
        h.as(USERS.dev, (tx) => tx.insert(workspaceMembers).values(join(USERS.val, "qa"))),
      ),
    ).toMatch(/row-level security/);
    const [added] = await h.as(USERS.adi, (tx) =>
      tx.insert(workspaceMembers).values(join(USERS.val, "qa")).returning(),
    );
    expect(added!.role).toBe("qa");
    expect(
      await h.as(USERS.val, (tx) =>
        tx.delete(workspaceMembers).where(inAnasTeam(USERS.val)).returning(),
      ),
    ).toHaveLength(1);
  });

  it("only owners make owners", async () => {
    expect(
      await failure(
        h.as(USERS.adi, (tx) => tx.insert(workspaceMembers).values(join(USERS.val, "owner"))),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        h.as(USERS.adi, (tx) =>
          tx.update(workspaceMembers).set({ role: "owner" }).where(inAnasTeam(USERS.adi)),
        ),
      ),
    ).toMatch(/row-level security/);
    const [promoted] = await h.as(USERS.ana, (tx) =>
      tx.update(workspaceMembers).set({ role: "admin" }).where(inAnasTeam(USERS.pam)).returning(),
    );
    expect(promoted!.role).toBe("admin");
  });

  it("an admin can't demote or remove an owner", async () => {
    expect(
      await h.as(USERS.adi, (tx) =>
        tx
          .update(workspaceMembers)
          .set({ role: "developer" })
          .where(inAnasTeam(USERS.ana))
          .returning(),
      ),
    ).toEqual([]);
    expect(
      await h.as(USERS.adi, (tx) =>
        tx.delete(workspaceMembers).where(inAnasTeam(USERS.ana)).returning(),
      ),
    ).toEqual([]);
  });

  it("nobody takes over or gives away a workspace; admins can rename it", async () => {
    for (const user of [USERS.adi, USERS.ana])
      expect(
        await failure(
          h.as(user, (tx) =>
            tx.update(workspaces).set({ ownerId: USERS.adi }).where(eq(workspaces.id, WS.ana)),
          ),
        ),
      ).toMatch(/row-level security/);
    const [renamed] = await h.as(USERS.adi, (tx) =>
      tx
        .update(workspaces)
        .set({ name: "Ana's squad" })
        .where(eq(workspaces.id, WS.ana))
        .returning(),
    );
    expect(renamed).toMatchObject({ name: "Ana's squad", ownerId: USERS.ana });
  });

  it("the membership functions are closed to anonymous visitors", async () => {
    expect(
      await failure(h.asAnon((tx) => tx.execute(sql`select private.is_member(${WS.ana})`))),
    ).toMatch(/permission denied/);
  });
});
