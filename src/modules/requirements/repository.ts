import { readState, transact } from "@/src/db/store";

import type { ClarifyingQuestion, Requirement } from "./schema";

const scoped =
  (workspaceId: string, projectId: string) => (r: { workspaceId: string; projectId: string }) =>
    r.workspaceId === workspaceId && r.projectId === projectId;

/** Next display code: FR-03 / NFR-02, continuing after the highest existing number for that prefix. */
export function nextCode(existing: { code: string }[], type: Requirement["type"]): string {
  const prefix = type === "functional" ? "FR" : "NFR";
  const max = existing
    .map((r) => /^(N?FR)-(\d+)$/.exec(r.code))
    .filter((m): m is RegExpExecArray => m?.[1] === prefix)
    .reduce((n, m) => Math.max(n, Number(m[2])), 0);
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/**
 * The current version of each requirement (ADR-006): the highest version per code, in the order the
 * codes first appeared. After a withdrawal (PF-053) the current version is REJECTED.
 */
export function currentRequirements(rows: Requirement[]): Requirement[] {
  const latest = new Map<string, Requirement>();
  for (const r of rows) {
    const seen = latest.get(r.code);
    if (!seen || r.version > seen.version) latest.set(r.code, r);
  }
  return [...latest.values()];
}

export const requirementRepository = {
  /** Current versions only — what every screen and stage works from. */
  async listByProject(workspaceId: string, projectId: string): Promise<Requirement[]> {
    const state = await readState();
    return currentRequirements(state.requirements.filter(scoped(workspaceId, projectId)));
  },

  /** Every version, oldest first (change history, PF-053). */
  async listVersions(workspaceId: string, projectId: string): Promise<Requirement[]> {
    const state = await readState();
    return state.requirements.filter(scoped(workspaceId, projectId));
  },

  /** Inserts a new version of an existing code, or a new code when `code` is null. */
  async insertVersion(
    row: Omit<Requirement, "code"> & { code: string | null },
  ): Promise<Requirement> {
    return transact((state) => {
      const siblings = state.requirements.filter(scoped(row.workspaceId, row.projectId));
      const version = { ...row, code: row.code ?? nextCode(siblings, row.type) };
      state.requirements.push(version);
      return version;
    });
  },

  async findById(workspaceId: string, id: string): Promise<Requirement | null> {
    const state = await readState();
    return state.requirements.find((r) => r.workspaceId === workspaceId && r.id === id) ?? null;
  },

  /** Inserts with the next free code for its type. */
  async insert(requirement: Omit<Requirement, "code">): Promise<Requirement> {
    return transact((state) => {
      const siblings = state.requirements.filter(
        scoped(requirement.workspaceId, requirement.projectId),
      );
      const row = { ...requirement, code: nextCode(siblings, requirement.type) };
      state.requirements.push(row);
      return row;
    });
  },

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<Requirement>,
  ): Promise<Requirement | null> {
    return transact((state) => {
      const row = state.requirements.find((r) => r.workspaceId === workspaceId && r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },

  /** Gate 1: every DRAFT requirement of the project becomes APPROVED. Returns how many. */
  async approveDrafts(
    workspaceId: string,
    projectId: string,
    by: string,
    at: string,
  ): Promise<number> {
    return transact((state) => {
      const drafts = state.requirements.filter(
        (r) => scoped(workspaceId, projectId)(r) && r.status === "DRAFT",
      );
      for (const r of drafts)
        Object.assign(r, { status: "APPROVED", approvedBy: by, approvedAt: at, updatedAt: at });
      return drafts.length;
    });
  },
};

export const questionRepository = {
  async listByProject(workspaceId: string, projectId: string): Promise<ClarifyingQuestion[]> {
    const state = await readState();
    return state.questions.filter(scoped(workspaceId, projectId));
  },

  async findById(workspaceId: string, id: string): Promise<ClarifyingQuestion | null> {
    const state = await readState();
    return state.questions.find((q) => q.workspaceId === workspaceId && q.id === id) ?? null;
  },

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<ClarifyingQuestion>,
  ): Promise<ClarifyingQuestion | null> {
    return transact((state) => {
      const row = state.questions.find((q) => q.workspaceId === workspaceId && q.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },
};
