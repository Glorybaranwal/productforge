import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { recordAudit } from "@/src/modules/audit/service";
import { getProject } from "@/src/modules/projects/service";
import { discoveryRepository } from "@/src/modules/requirements/discovery-repository";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { sourceRepository } from "./repository";
import { SourceInput, type SourceDocument } from "./schema";

export async function listSources(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<SourceDocument[]> {
  await getProject(ctx, projectId);
  return sourceRepository.listByProject(ctx.workspace.id, projectId);
}

/** Adds pasted notes or an uploaded text file to the project. Text is stored as untrusted data. */
export async function addSource(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<SourceDocument> {
  await getProject(ctx, projectId);
  const data = parseOrThrow(SourceInput, input);
  const source = await sourceRepository.insert({
    id: newId(),
    workspaceId: ctx.workspace.id,
    projectId,
    name: data.name,
    kind: data.kind,
    text: data.text,
    charCount: data.text.length,
    createdBy: ctx.session.userId,
    createdAt: nowIso(),
  });
  await recordAudit(ctx, {
    entityType: "project",
    entityId: projectId,
    action: "source.added",
    diff: { source: { from: null, to: source.name } },
  });
  return source;
}

export async function deleteSource(
  ctx: WorkspaceContext,
  projectId: string,
  sourceId: string,
): Promise<void> {
  await getProject(ctx, projectId);
  const discovery = await discoveryRepository.get(ctx.workspace.id, projectId);
  if (discovery?.status === "confirmed") {
    throw new AppError(
      "CONFLICT",
      "Sources can't be removed after requirements are confirmed — they're the evidence",
    );
  }
  const sources = await sourceRepository.listByProject(ctx.workspace.id, projectId);
  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new AppError("NOT_FOUND", "Source not found");
  await sourceRepository.remove(ctx.workspace.id, projectId, sourceId);
  await recordAudit(ctx, {
    entityType: "project",
    entityId: projectId,
    action: "source.removed",
    diff: { source: { from: source.name, to: null } },
  });
}
