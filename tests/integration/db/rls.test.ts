/**
 * Workspace isolation (PF-012, ADR-020): what a user can see and change across workspaces, and the
 * basic roles inside one. Setup (real migrations on PGlite, Supabase stand-in) is in rls-harness.ts.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditLogs, projects, workspaceMembers, workspaces } from "@/src/db/schema";

import { createRlsDb, failure, names, PROJECT, type RlsHarness, USERS, WS } from "./rls-harness";

let pg: RlsHarness["pg"];
let db: RlsHarness["db"];
let as: RlsHarness["as"];
let asAnon: RlsHarness["asAnon"];

beforeAll(async () => {
  ({ pg, db, as, asAnon } = await createRlsDb());
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

describe("workspace isolation (PF-012)", () => {
  it("a user sees only their own workspace's projects", async () => {
    expect(names(await as(USERS.ana, (tx) => tx.select().from(projects)))).toEqual(["Alpha"]);
    expect(names(await as(USERS.ben, (tx) => tx.select().from(projects)))).toEqual(["Bravo"]);
    expect(
      await as(USERS.ana, (tx) => tx.select().from(projects).where(eq(projects.id, PROJECT.bravo))),
    ).toEqual([]);
    expect(await as(USERS.newbie, (tx) => tx.select().from(projects))).toEqual([]);
  });

  it("a user can't change, delete or add projects in another workspace", async () => {
    const renamed = await as(USERS.ana, (tx) =>
      tx.update(projects).set({ name: "Hacked" }).where(eq(projects.id, PROJECT.bravo)).returning(),
    );
    expect(renamed).toEqual([]);
    expect(
      await as(USERS.ana, (tx) =>
        tx.delete(projects).where(eq(projects.id, PROJECT.bravo)).returning(),
      ),
    ).toEqual([]);
    expect(
      await failure(
        as(USERS.ana, (tx) =>
          tx.insert(projects).values({
            workspaceId: WS.ben,
            name: "Sneaky",
            domain: "Fintech",
            audience: "Anyone",
            teamSize: 3,
            sprintLengthDays: 7,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    const [bravo] = await db.select().from(projects).where(eq(projects.id, PROJECT.bravo));
    expect(bravo!.name).toBe("Bravo");
  });

  it("sees only its own workspaces and their members", async () => {
    expect(names(await as(USERS.ana, (tx) => tx.select().from(workspaces)))).toEqual([
      "Ana's team",
    ]);
    expect(names(await as(USERS.dev, (tx) => tx.select().from(workspaces)))).toEqual([
      "Ana's team",
    ]);
    // Teammates are visible (a team page needs them); other workspaces' members are not.
    const teammates = await as(USERS.dev, (tx) => tx.select().from(workspaceMembers));
    expect(teammates.map((m) => m.role).sort()).toEqual(["admin", "developer", "owner", "pm"]);
    expect(teammates.every((m) => m.workspaceId === WS.ana)).toBe(true);
    expect(await as(USERS.ben, (tx) => tx.select().from(workspaceMembers))).toEqual([
      expect.objectContaining({ workspaceId: WS.ben, userId: USERS.ben, role: "owner" }),
    ]);
    expect(
      await failure(
        as(USERS.ben, (tx) =>
          tx
            .insert(workspaceMembers)
            .values({ workspaceId: WS.ana, userId: USERS.ben, role: "owner" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("follows the roles inside a workspace", async () => {
    const draft = {
      workspaceId: WS.ana,
      domain: "Fintech",
      audience: "Retail customers",
      teamSize: 4,
      sprintLengthDays: 14,
    };
    // A developer reads but can't create, edit or delete.
    expect(names(await as(USERS.dev, (tx) => tx.select().from(projects)))).toEqual(["Alpha"]);
    expect(
      await failure(as(USERS.dev, (tx) => tx.insert(projects).values({ ...draft, name: "Dev's" }))),
    ).toMatch(/row-level security/);
    expect(
      await as(USERS.dev, (tx) =>
        tx
          .update(projects)
          .set({ name: "Renamed" })
          .where(eq(projects.id, PROJECT.alpha))
          .returning(),
      ),
    ).toEqual([]);
    // A PM creates and edits, but only owners and admins delete.
    const [gamma] = await as(USERS.pam, (tx) =>
      tx
        .insert(projects)
        .values({ ...draft, name: "Gamma" })
        .returning(),
    );
    expect(gamma!.name).toBe("Gamma");
    expect(
      await as(USERS.pam, (tx) =>
        tx.delete(projects).where(eq(projects.id, gamma!.id)).returning(),
      ),
    ).toEqual([]);
    expect(
      await as(USERS.ana, (tx) =>
        tx.delete(projects).where(eq(projects.id, gamma!.id)).returning(),
      ),
    ).toHaveLength(1);
  });

  it("a new user creates a workspace and joins it as its owner", async () => {
    const ws = await as(USERS.newbie, async (tx) => {
      const [created] = await tx
        .insert(workspaces)
        .values({ name: "Newbie's team", ownerId: USERS.newbie })
        .returning();
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: created!.id, userId: USERS.newbie, role: "owner" });
      return created!;
    });
    expect(names(await as(USERS.newbie, (tx) => tx.select().from(workspaces)))).toEqual([
      "Newbie's team",
    ]);
    // …but can't create one in someone else's name.
    expect(
      await failure(
        as(USERS.newbie, (tx) =>
          tx.insert(workspaces).values({ name: "Fake", ownerId: USERS.ana }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(ws.ownerId).toBe(USERS.newbie);
  });

  it("keeps the audit trail append-only and unforgeable", async () => {
    expect(
      (await as(USERS.ana, (tx) => tx.select().from(auditLogs))).map((e) => e.actorName),
    ).toEqual(["Ana"]);
    const entry = {
      workspaceId: WS.ana,
      entityType: "project",
      entityId: PROJECT.alpha,
      action: "project.updated",
    };
    await as(USERS.ana, (tx) =>
      tx.insert(auditLogs).values({ ...entry, actorId: USERS.ana, actorName: "Ana" }),
    );
    expect(
      await failure(
        as(USERS.ana, (tx) =>
          tx.insert(auditLogs).values({ ...entry, actorId: USERS.ben, actorName: "Ben" }),
        ),
      ),
    ).toMatch(/row-level security/);
    // Not even the owner may rewrite or delete history: no policy and, since ADR-023, no privilege.
    expect(
      await failure(as(USERS.ana, (tx) => tx.update(auditLogs).set({ action: "rewritten" }))),
    ).toMatch(/permission denied/);
    expect(await failure(as(USERS.ana, (tx) => tx.delete(auditLogs)))).toMatch(/permission denied/);
  });

  it("anonymous visitors can't touch the tables at all (ADR-023)", async () => {
    for (const table of [projects, workspaces, workspaceMembers, auditLogs])
      expect(await failure(asAnon((tx) => tx.select().from(table)))).toMatch(/permission denied/);
  });

  it("the user's identity ends with the transaction", async () => {
    await as(USERS.ana, (tx) => tx.select().from(projects));
    const result = await pg.query<{ who: string; sub: string | null }>(
      "select current_user as who, nullif(current_setting('request.jwt.claim.sub', true), '') as sub",
    );
    expect(result.rows[0]).toEqual({ who: "postgres", sub: null });
  });
});
