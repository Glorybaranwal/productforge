import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/src/lib/errors";
import { listAudit } from "@/src/modules/audit/service";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/src/modules/projects/service";
import { ensureWorkspace } from "@/src/modules/workspaces/service";
import { makeContext, resetDb, validProject } from "@/tests/helpers/context";

async function expectAppError(promise: Promise<unknown>, code: AppError["code"]) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

beforeEach(() => resetDb());

describe("workspace bootstrap", () => {
  it("creates a default workspace with the user as owner, once", async () => {
    const session = { userId: "u-1", name: "Asha", email: "asha@example.com" };
    const first = await ensureWorkspace(session);
    const second = await ensureWorkspace(session);
    expect(first.role).toBe("owner");
    expect(first.workspace.name).toBe("My workspace");
    expect(second.workspace.id).toBe(first.workspace.id);
  });
});

describe("projects service", () => {
  it("creates a project, lists it and records an audit entry", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);

    expect(project.workspaceId).toBe(ctx.workspace.id);
    expect(await listProjects(ctx)).toEqual([project]);
    expect(await getProject(ctx, project.id)).toEqual(project);

    const audit = await listAudit(ctx, "project", project.id);
    expect(audit.map((a) => a.action)).toEqual(["project.created"]);
  });

  it("rejects invalid input with VALIDATION_ERROR", async () => {
    const ctx = await makeContext();
    await expectAppError(createProject(ctx, { ...validProject, name: "" }), "VALIDATION_ERROR");
  });

  it("updates only changed fields and records them as a diff", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    const updated = await updateProject(ctx, project.id, { teamSize: 8, domain: "Fintech" });

    expect(updated.teamSize).toBe(8);
    const [latest] = await listAudit(ctx, "project", project.id);
    expect(latest?.action).toBe("project.updated");
    expect(latest?.diff).toEqual({ teamSize: { from: 5, to: 8 } });
  });

  it("does not write an audit entry when nothing changed", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    await updateProject(ctx, project.id, { teamSize: 5 });
    expect(await listAudit(ctx, "project", project.id)).toHaveLength(1);
  });

  it("deletes a project and keeps the audit trail", async () => {
    const ctx = await makeContext();
    const project = await createProject(ctx, validProject);
    await deleteProject(ctx, project.id);

    expect(await listProjects(ctx)).toEqual([]);
    await expectAppError(getProject(ctx, project.id), "NOT_FOUND");
    const audit = await listAudit(ctx, "project", project.id);
    expect(audit[0]?.action).toBe("project.deleted");
  });

  it("keeps workspaces isolated: another user can't see or change the project", async () => {
    const owner = await makeContext();
    const outsider = await makeContext();
    const project = await createProject(owner, validProject);

    expect(await listProjects(outsider)).toEqual([]);
    await expectAppError(getProject(outsider, project.id), "NOT_FOUND");
    await expectAppError(updateProject(outsider, project.id, { teamSize: 1 }), "NOT_FOUND");
  });

  it("enforces roles: developers can't create, PMs can't delete", async () => {
    const owner = await makeContext();
    const project = await createProject(owner, validProject);

    await expectAppError(createProject({ ...owner, role: "developer" }, validProject), "FORBIDDEN");
    await expectAppError(deleteProject({ ...owner, role: "pm" }, project.id), "FORBIDDEN");
  });
});
