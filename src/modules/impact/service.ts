import type { StageDeps } from "@/src/ai/orchestrator/run-stage";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { withIdempotency } from "@/src/lib/idempotency";
import { newId, nowIso } from "@/src/lib/ids";
import { requirementRepository } from "@/src/modules/requirements/repository";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import {
  analyze,
  audit,
  candidatesFor,
  find,
  load,
  requireProposed,
  result,
  type AnalysisResult,
} from "./access";
import { affectedOf } from "./candidates";
import { impactRepository } from "./repository";
import { ChangeProposal, changeCode, type RequirementChange } from "./schema";
import { buildChangeViews, requirementOptions, type ChangesOverview } from "./view";

export type { AnalysisResult } from "./access";
export { approveChange, discardChange, markReviewed } from "./decide";

export type ImpactStatus = {
  state: "locked" | "ready" | "review" | "clear";
  changes: number;
  proposed: number;
  pending: number;
};

export async function getChangesOverview(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ChangesOverview> {
  const { b, rows, plan, gate1Passed } = await load(ctx, projectId);
  const current = await requirementRepository.listByProject(ctx.workspace.id, projectId);
  const changes = buildChangeViews(rows, b, `/dashboard/projects/${projectId}`, (c) =>
    JSON.stringify(affectedOf(candidatesFor(c, b, plan))),
  );
  const options = requirementOptions(current, rows.changes).filter(
    (r) => r.status === "APPROVED" || (r.status === "REJECTED" && r.changedBy),
  );
  return {
    gate1Passed,
    requirements: options,
    changes,
    pending: changes.reduce((n, c) => n + c.pending, 0),
  };
}

export function summarizeChanges(o: ChangesOverview): ImpactStatus {
  const approved = o.changes.filter((c) => c.status === "APPROVED").length;
  return {
    state: !o.gate1Passed ? "locked" : o.pending ? "review" : approved ? "clear" : "ready",
    changes: approved,
    proposed: o.changes.filter((c) => c.status === "DRAFT").length,
    pending: o.pending,
  };
}

export async function getImpactStatus(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<ImpactStatus> {
  return summarizeChanges(await getChangesOverview(ctx, projectId));
}

/** Proposes a change (PF-053) and explains its impact. Nothing changes until it's approved. */
export async function proposeChange(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
  idempotencyKey: string | null,
  deps: StageDeps = {},
): Promise<AnalysisResult> {
  requireRole(ctx.role, MANAGER_ROLES, "propose requirement changes");
  const p = parseOrThrow(ChangeProposal, input);
  const ws = ctx.workspace.id;
  const { result: change, replayed } = await withIdempotency<RequirementChange>(
    ctx,
    `change:${projectId}`,
    idempotencyKey,
    async () => {
      const { b, rows, plan, gate1Passed } = await load(ctx, projectId);
      if (!gate1Passed)
        throw new AppError(
          "CONFLICT",
          "Requirements aren't confirmed yet — edit them on the discovery page",
        );
      const current = await requirementRepository.listByProject(ws, projectId);
      let code: string | null = null;
      let fromVersion: number | null = null;
      let before: RequirementChange["before"] = null;
      let after: RequirementChange["after"] = null;
      if (p.kind === "add") {
        after = { text: p.text, type: p.type, evidence: p.evidence };
        const same = current.find(
          (r) => r.status === "APPROVED" && r.text.toLowerCase() === p.text.toLowerCase(),
        );
        if (same) throw new AppError("CONFLICT", `${same.code} already says this`);
      } else {
        const r = current.find((x) => x.code === p.requirementCode);
        if (!r)
          throw new AppError(
            "NOT_FOUND",
            `${p.requirementCode} isn't a requirement in this project`,
          );
        if (r.status !== "APPROVED")
          throw new AppError("CONFLICT", `${r.code} isn't approved, so there's nothing to change`);
        const open = rows.changes.find((c) => c.status === "DRAFT" && c.requirementCode === r.code);
        if (open)
          throw new AppError(
            "CONFLICT",
            `${changeCode(open.number)} already proposes a change to ${r.code} — approve or discard it first`,
          );
        code = r.code;
        fromVersion = r.version;
        before = { text: r.text, type: r.type, evidence: r.evidence };
        if (p.kind === "modify") {
          after = { text: p.text, type: r.type, evidence: p.evidence };
          if (after.text === before.text && after.evidence === before.evidence)
            throw new AppError("VALIDATION_ERROR", "Some fields are invalid", [
              { path: "text", message: "Nothing changes — edit the wording or the evidence" },
            ]);
        }
      }
      const candidates = candidatesFor({ kind: p.kind, requirementCode: code }, b, plan);
      const row = await impactRepository.insert({
        id: newId(),
        workspaceId: ws,
        projectId,
        kind: p.kind,
        requirementCode: code,
        fromVersion,
        toVersion: null,
        before,
        after,
        reason: p.reason,
        status: "DRAFT",
        affected: affectedOf(candidates),
        impact: null,
        agentRunId: null,
        createdBy: ctx.session.name,
        createdAt: nowIso(),
        decidedBy: null,
        decidedAt: null,
      });
      await audit(ctx, row, "change.proposed", { reason: { from: null, to: p.reason } });
      await analyze(ctx, row, b, candidates, deps);
      return row;
    },
    (id) => impactRepository.find(ws, id),
  );
  return result(ctx, change.id, replayed);
}

/** Runs the analysis again (it failed, or the backlog changed since). Proposals only. */
export async function reanalyzeChange(
  ctx: WorkspaceContext,
  changeId: string,
  deps: StageDeps = {},
): Promise<AnalysisResult> {
  requireRole(ctx.role, MANAGER_ROLES, "propose requirement changes");
  const change = await find(ctx, changeId);
  requireProposed(change);
  const { b, plan } = await load(ctx, change.projectId);
  const candidates = candidatesFor(change, b, plan);
  const fresh = await impactRepository.update(ctx.workspace.id, change.id, {
    affected: affectedOf(candidates),
  });
  await analyze(ctx, fresh ?? change, b, candidates, deps);
  return result(ctx, change.id, false);
}
