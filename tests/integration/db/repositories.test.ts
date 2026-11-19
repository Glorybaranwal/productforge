/**
 * Workspaces, projects and the audit trail in Postgres, through the real services (PF-015,
 * ADR-022). Runs the migrations on PGlite and every call as the signed-in user, like `withUser`.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DbSession } from "@/src/db/client";
import { auditLogs, projects, workspaces } from "@/src/db/schema";
import { setUserRunner, unitOfWork, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { listAudit } from "@/src/modules/audit/service";
import { projectRepository } from "@/src/modules/projects/repository";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/src/modules/projects/service";
import { ensureWorkspace } from "@/src/modules/workspaces/service";
import { validProject } from "@/tests/helpers/context";

import { createRlsDb, PROJECT, type RlsHarness, USERS, WS } from "./rls-harness";

let h: RlsHarness;
const person = (userId: string, name: string): Session => ({
  userId,
  name,
  email: `${name.toLowerCase()}@example.com`,
});
const ANA = person(USERS.ana, "Ana");
const DEV = person(USERS.dev, "Dev");
const NEWBIE = person(USERS.newbie, "Newbie");

beforeAll(async () => {
  h = await createRlsDb();
  const runner = (session: DbSession, fn: never) => h.as(session.userId, fn);
  setUserRunner(runner as unknown as UserRunner);
}, 60_000);

afterAll(async () => {
  setUserRunner(null);
  await h?.pg.close();
});

beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

afterEach(() => vi.unstubAllEnvs());

describe("Postgres repositories (PF-015)", () => {
  it("finds a member's workspace and role", async () => {
    expect(await ensureWorkspace(ANA)).toMatchObject({ workspace: { id: WS.ana }, role: "owner" });
    expect(await ensureWorkspace(DEV)).toMatchObject({
      workspace: { id: WS.ana },
      role: "developer",
    });
  });

  it("creates one workspace on a first visit, with its owner and an audit entry", async () => {
    const first = await ensureWorkspace(NEWBIE);
    expect(first).toMatchObject({ workspace: { name: "My workspace" }, role: "owner" });
    expect((await ensureWorkspace(NEWBIE)).workspace.id).toBe(first.workspace.id);

    const owned = await h.db.select().from(workspaces).where(eq(workspaces.ownerId, NEWBIE.userId));
    expect(owned).toHaveLength(1);
    const entries = await h.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, first.workspace.id));
    expect(entries.map((e) => e.action)).toEqual(["workspace.created"]);
  });

  it("creates, lists, edits and deletes projects, each with its audit entry", async () => {
    const ctx = await ensureWorkspace(ANA);
    const created = await createProject(ctx, validProject);
    expect(created).toMatchObject({ workspaceId: WS.ana, createdBy: ANA.userId });
    expect((await listProjects(ctx)).map((p) => p.name)).toEqual([validProject.name, "Alpha"]);
    expect(await getProject(ctx, created.id)).toEqual(created);

    const renamed = await updateProject(ctx, created.id, { name: "Payments dashboard" });
    expect(renamed.name).toBe("Payments dashboard");
    await deleteProject(ctx, created.id);
    await expect(getProject(ctx, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const trail = await listAudit(ctx, "project", created.id);
    expect(trail.map((e) => e.action)).toEqual([
      "project.deleted",
      "project.updated",
      "project.created",
    ]);
    expect(trail[1]!.diff).toEqual({ name: { from: validProject.name, to: "Payments dashboard" } });
  });

  it("never reaches another workspace's project, even with a forged context", async () => {
    const ctx = await ensureWorkspace(ANA);
    await expect(getProject(ctx, PROJECT.bravo)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A bug that points Ana's context at Ben's workspace still finds nothing: RLS decides.
    const forged = { ...ctx, workspace: { ...ctx.workspace, id: WS.ben } };
    expect(await listProjects(forged)).toEqual([]);
    await expect(updateProject(forged, PROJECT.bravo, { name: "Hacked" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const [bravo] = await h.db.select().from(projects).where(eq(projects.id, PROJECT.bravo));
    expect(bravo!.name).toBe("Bravo");
  });

  it("refuses in the database what the role check would refuse in the app", async () => {
    const ctx = await ensureWorkspace(DEV);
    // A bug that hands a developer the owner role: the insert is still denied, as FORBIDDEN.
    await expect(
      createProject({ ...ctx, role: "owner" }, { ...validProject, name: "Dev's project" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rows = await h.db.select().from(projects).where(eq(projects.name, "Dev's project"));
    expect(rows).toEqual([]);
  });

  it("saves a unit of work all together or not at all", async () => {
    const ctx = await ensureWorkspace(ANA);
    const id = "00000000-0000-4000-8000-000000000299";
    const now = new Date().toISOString();
    await expect(
      unitOfWork(ctx, async (scope) => {
        await projectRepository.insert(scope, {
          ...validProject,
          id,
          workspaceId: WS.ana,
          createdBy: ANA.userId,
          createdAt: now,
          updatedAt: now,
        });
        throw new Error("audit write failed");
      }),
    ).rejects.toThrow("audit write failed");
    expect(await h.db.select().from(projects).where(eq(projects.id, id))).toEqual([]);
  });

  it("treats an id that isn't a uuid as not found", async () => {
    const ctx = await ensureWorkspace(ANA);
    await expect(getProject(ctx, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
