import { cache } from "react";

import { unitOfWork } from "@/src/db/scope";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { projectRepository } from "./repository";
import { ProjectInput, ProjectUpdate, type Project } from "./schema";

const ENTITY = "project";

export async function listProjects(ctx: WorkspaceContext): Promise<Project[]> {
  return projectRepository.listByWorkspace(ctx, ctx.workspace.id);
}

/**
 * Every project page section checks the project first, so the lookup is cached for the request
 * (React `cache`, keyed by the request's context object): one query instead of ten (ADR-023).
 * Inside a unit of work the context is a new object, so reads there always see the transaction.
 */
export const getProject = cache(async (ctx: WorkspaceContext, id: string): Promise<Project> => {
  const project = await projectRepository.findById(ctx, ctx.workspace.id, id);
  if (!project) throw new AppError("NOT_FOUND", "Project not found");
  return project;
});

/** Each change and its audit entry are one unit of work: in Postgres, saved together or not at all. */
export async function createProject(ctx: WorkspaceContext, input: unknown): Promise<Project> {
  requireRole(ctx.role, MANAGER_ROLES, "create projects");
  const data = parseOrThrow(ProjectInput, input);
  const now = nowIso();
  return unitOfWork(ctx, async (ctx) => {
    const project = await projectRepository.insert(ctx, {
      ...data,
      id: newId(),
      workspaceId: ctx.workspace.id,
      createdBy: ctx.session.userId,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(ctx, { entityType: ENTITY, entityId: project.id, action: "project.created" });
    return project;
  });
}

export async function updateProject(
  ctx: WorkspaceContext,
  id: string,
  input: unknown,
): Promise<Project> {
  requireRole(ctx.role, MANAGER_ROLES, "edit project settings");
  const patch = parseOrThrow(ProjectUpdate, input);
  return unitOfWork(ctx, async (ctx) => {
    const current = await getProject(ctx, id);
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, value] of Object.entries(patch) as [keyof typeof patch, unknown][]) {
      if (value !== undefined && current[field] !== value) {
        diff[field] = { from: current[field], to: value };
      }
    }
    if (Object.keys(diff).length === 0) return current;

    const updated = await projectRepository.update(ctx, ctx.workspace.id, id, patch, nowIso());
    if (!updated) throw new AppError("NOT_FOUND", "Project not found");
    await recordAudit(ctx, { entityType: ENTITY, entityId: id, action: "project.updated", diff });
    return updated;
  });
}

export async function deleteProject(ctx: WorkspaceContext, id: string): Promise<void> {
  requireRole(ctx.role, ["owner", "admin"], "delete projects");
  await unitOfWork(ctx, async (ctx) => {
    const project = await getProject(ctx, id);
    await projectRepository.remove(ctx, ctx.workspace.id, id);
    await recordAudit(ctx, {
      entityType: ENTITY,
      entityId: id,
      action: "project.deleted",
      diff: { name: { from: project.name, to: null } },
    });
  });
}
