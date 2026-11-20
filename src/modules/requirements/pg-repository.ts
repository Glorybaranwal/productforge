import { and, asc, eq } from "drizzle-orm";

import type { Tx } from "@/src/db/client";
import { clarifyingQuestions, requirements } from "@/src/db/schema";
import { inUserTx, iso, isUuid, lockProject, withDates, type WorkspaceScope } from "@/src/db/scope";

import { currentRequirements, nextCode } from "./codes";
import type { NewRequirement, QuestionRepository, RequirementRepository } from "./repository";
import type { ClarifyingQuestion, Requirement } from "./schema";

export const toRequirement = (r: typeof requirements.$inferSelect): Requirement => ({
  id: r.id,
  workspaceId: r.workspaceId,
  projectId: r.projectId,
  code: r.code,
  version: r.version,
  text: r.text,
  type: r.type,
  evidence: r.evidence,
  sourceQuote: r.sourceQuote,
  rationale: r.rationale,
  sourceId: r.sourceId,
  status: r.status,
  origin: r.origin,
  agentRunId: r.agentRunId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  approvedBy: r.approvedBy,
  approvedAt: iso(r.approvedAt),
});

const toQuestion = (q: typeof clarifyingQuestions.$inferSelect): ClarifyingQuestion => ({
  id: q.id,
  workspaceId: q.workspaceId,
  projectId: q.projectId,
  question: q.question,
  reason: q.reason,
  state: q.state,
  answer: q.answer,
  agentRunId: q.agentRunId,
  createdAt: q.createdAt.toISOString(),
  resolvedAt: iso(q.resolvedAt),
});

const REQUIREMENT_DATES = ["createdAt", "updatedAt", "approvedAt"] as const;
const IDENTITY = ["id", "workspaceId", "projectId"] as const;

/** A domain patch as column values: identity columns are never changed, ISO strings become dates. */
function patchValues<T extends Record<string, unknown>>(patch: T, dates: readonly string[]) {
  const rest: Record<string, unknown> = { ...patch };
  for (const key of IDENTITY) delete rest[key];
  return withDates(rest, dates);
}

const codeNumber = (code: string) => Number(code.split("-")[1]);

/** Oldest first; rows saved together keep the order they were written in (FR before NFR, by number). */
export function byCreation(a: Requirement, b: Requirement): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    (a.type === b.type ? 0 : a.type === "functional" ? -1 : 1) ||
    codeNumber(a.code) - codeNumber(b.code) ||
    a.version - b.version
  );
}

const inProject = (scope: WorkspaceScope, projectId: string) =>
  and(eq(requirements.workspaceId, scope.workspace.id), eq(requirements.projectId, projectId));

async function allVersions(tx: Tx, scope: WorkspaceScope, projectId: string) {
  const rows = await tx
    .select()
    .from(requirements)
    .where(inProject(scope, projectId))
    .orderBy(asc(requirements.createdAt));
  return rows.map(toRequirement).sort(byCreation);
}

/** Inserts `row` with its code, or the next free code for its type, under the project lock. */
async function insertCoded(
  tx: Tx,
  scope: WorkspaceScope,
  row: NewRequirement & { code: string | null },
): Promise<Requirement> {
  await lockProject(tx, row.projectId);
  const siblings = await tx
    .select({ code: requirements.code })
    .from(requirements)
    .where(inProject(scope, row.projectId));
  const code = row.code ?? nextCode(siblings, row.type);
  const values = withDates({ ...row, code }, REQUIREMENT_DATES) as typeof requirements.$inferInsert;
  const [saved] = await tx.insert(requirements).values(values).returning();
  return toRequirement(saved!);
}

/** Supabase Postgres, as the signed-in user: RLS applies to every statement (PF-070, ADR-026). */
export const pgRequirements: RequirementRepository = {
  listByProject: (scope, projectId) =>
    inUserTx(scope, async (tx) =>
      isUuid(projectId) ? currentRequirements(await allVersions(tx, scope, projectId)) : [],
    ),

  listVersions: (scope, projectId) =>
    inUserTx(scope, async (tx) => (isUuid(projectId) ? allVersions(tx, scope, projectId) : [])),

  insertVersion: (scope, row) => inUserTx(scope, (tx) => insertCoded(tx, scope, row)),

  insert: (scope, requirement) =>
    inUserTx(scope, (tx) => insertCoded(tx, scope, { ...requirement, code: null })),

  findById: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(requirements)
        .where(and(eq(requirements.workspaceId, scope.workspace.id), eq(requirements.id, id)))
        .limit(1);
      return row ? toRequirement(row) : null;
    }),

  // RLS refuses to touch an APPROVED row, so a stale call finds nothing rather than rewriting history.
  update: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .update(requirements)
        .set(patchValues(patch, REQUIREMENT_DATES))
        .where(and(eq(requirements.workspaceId, scope.workspace.id), eq(requirements.id, id)))
        .returning();
      return row ? toRequirement(row) : null;
    }),

  approveDrafts: (scope, projectId, by, at) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return 0;
      const when = new Date(at);
      const approved = await tx
        .update(requirements)
        .set({ status: "APPROVED", approvedBy: by, approvedAt: when, updatedAt: when })
        .where(and(inProject(scope, projectId), eq(requirements.status, "DRAFT")))
        .returning({ id: requirements.id });
      return approved.length;
    }),
};

export const pgQuestions: QuestionRepository = {
  listByProject: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return [];
      const rows = await tx
        .select()
        .from(clarifyingQuestions)
        .where(
          and(
            eq(clarifyingQuestions.workspaceId, scope.workspace.id),
            eq(clarifyingQuestions.projectId, projectId),
          ),
        )
        .orderBy(asc(clarifyingQuestions.createdAt));
      return rows.map(toQuestion);
    }),

  findById: (scope, id) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .select()
        .from(clarifyingQuestions)
        .where(
          and(
            eq(clarifyingQuestions.workspaceId, scope.workspace.id),
            eq(clarifyingQuestions.id, id),
          ),
        )
        .limit(1);
      return row ? toQuestion(row) : null;
    }),

  update: (scope, id, patch) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(id)) return null;
      const [row] = await tx
        .update(clarifyingQuestions)
        .set(patchValues(patch, ["createdAt", "resolvedAt"]))
        .where(
          and(
            eq(clarifyingQuestions.workspaceId, scope.workspace.id),
            eq(clarifyingQuestions.id, id),
          ),
        )
        .returning();
      return row ? toQuestion(row) : null;
    }),
};
