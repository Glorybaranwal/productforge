import { impactRepository } from "@/src/modules/impact/repository";
import { changeCode } from "@/src/modules/impact/schema";
import { getProject } from "@/src/modules/projects/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { requirementRepository } from "./repository";
import type { Evidence, Requirement } from "./schema";

export type RequirementVersion = {
  version: number;
  text: string;
  type: Requirement["type"];
  evidence: Evidence;
  status: Requirement["status"];
  rationale: string | null;
  createdAt: string;
  /** The approved change request that produced this version; null for version 1. */
  change: { code: string; reason: string; status: string } | null;
};

export type RequirementHistory = { code: string; versions: RequirementVersion[] };

/** Every requirement with more than one version, each version with the change request behind it (PF-056). */
export async function getRequirementHistory(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<RequirementHistory[]> {
  await getProject(ctx, projectId);
  const [rows, { changes }] = await Promise.all([
    requirementRepository.listVersions(ctx, projectId),
    impactRepository.load(ctx, projectId),
  ]);
  const byCode = new Map<string, Requirement[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);

  return [...byCode.entries()]
    .filter(([, versions]) => versions.length > 1)
    .map(([code, versions]) => ({
      code,
      versions: versions
        .sort((x, y) => x.version - y.version)
        .map((r) => {
          const cr = changes.find(
            (c) =>
              c.requirementCode === code && c.toVersion === r.version && c.status === "APPROVED",
          );
          return {
            version: r.version,
            text: r.text,
            type: r.type,
            evidence: r.evidence,
            status: r.status,
            rationale: r.rationale,
            createdAt: r.createdAt,
            change: cr
              ? { code: changeCode(cr.number), reason: cr.reason, status: cr.status }
              : null,
          };
        }),
    }));
}
