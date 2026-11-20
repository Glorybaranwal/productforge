import { readState, transact } from "@/src/db/store";
import { newId, nowIso } from "@/src/lib/ids";
import { normalize } from "@/src/lib/text";

import { currentRequirements, nextCode } from "./codes";
import type { DiscoveryRepository } from "./discovery-repository";
import type { QuestionRepository, RequirementRepository } from "./repository";
import type { Discovery, Requirement } from "./schema";

type Owner = { workspaceId: string; projectId: string };
const scoped = (workspaceId: string, projectId: string) => (r: Owner) =>
  r.workspaceId === workspaceId && r.projectId === projectId;

/** Demo store (ADR-011). */
export const storeRequirements: RequirementRepository = {
  async listByProject(scope, projectId) {
    const state = await readState();
    return currentRequirements(state.requirements.filter(scoped(scope.workspace.id, projectId)));
  },

  async listVersions(scope, projectId) {
    const state = await readState();
    return state.requirements.filter(scoped(scope.workspace.id, projectId));
  },

  async insertVersion(_scope, row) {
    return transact((state) => {
      const siblings = state.requirements.filter(scoped(row.workspaceId, row.projectId));
      const version = { ...row, code: row.code ?? nextCode(siblings, row.type) };
      state.requirements.push(version);
      return version;
    });
  },

  async findById(scope, id) {
    const state = await readState();
    return (
      state.requirements.find((r) => r.workspaceId === scope.workspace.id && r.id === id) ?? null
    );
  },

  async insert(_scope, requirement) {
    return transact((state) => {
      const siblings = state.requirements.filter(
        scoped(requirement.workspaceId, requirement.projectId),
      );
      const row = { ...requirement, code: nextCode(siblings, requirement.type) };
      state.requirements.push(row);
      return row;
    });
  },

  async update(scope, id, patch) {
    return transact((state) => {
      const row = state.requirements.find(
        (r) => r.workspaceId === scope.workspace.id && r.id === id,
      );
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },

  async approveDrafts(scope, projectId, by, at) {
    return transact((state) => {
      const drafts = state.requirements.filter(
        (r) => scoped(scope.workspace.id, projectId)(r) && r.status === "DRAFT",
      );
      for (const r of drafts)
        Object.assign(r, { status: "APPROVED", approvedBy: by, approvedAt: at, updatedAt: at });
      return drafts.length;
    });
  },
};

export const storeQuestions: QuestionRepository = {
  async listByProject(scope, projectId) {
    const state = await readState();
    return state.questions.filter(scoped(scope.workspace.id, projectId));
  },

  async findById(scope, id) {
    const state = await readState();
    return state.questions.find((q) => q.workspaceId === scope.workspace.id && q.id === id) ?? null;
  },

  async update(scope, id, patch) {
    return transact((state) => {
      const row = state.questions.find((q) => q.workspaceId === scope.workspace.id && q.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    });
  },
};

export const storeDiscovery: DiscoveryRepository = {
  async get(scope, projectId) {
    const state = await readState();
    return state.discoveries.find(scoped(scope.workspace.id, projectId)) ?? null;
  },

  async applyRun(scope, projectId, output, agentRunId) {
    const owner: Owner = { workspaceId: scope.workspace.id, projectId };
    const now = nowIso();
    return transact((state) => {
      const mine = scoped(owner.workspaceId, owner.projectId);
      const replaceable = (r: Requirement) => mine(r) && r.status === "DRAFT" && r.origin === "ai";

      state.requirements = state.requirements.filter((r) => !replaceable(r));
      const kept = state.requirements.filter(mine);
      const seen = new Set(kept.map((r) => normalize(r.text)));
      for (const item of output.requirements) {
        const key = normalize(item.text);
        if (seen.has(key)) continue;
        seen.add(key);
        const siblings = state.requirements.filter(mine);
        state.requirements.push({
          id: newId(),
          ...owner,
          code: nextCode(siblings, item.type),
          version: 1,
          text: item.text,
          type: item.type,
          evidence: item.evidence,
          sourceQuote: item.sourceQuote,
          rationale: item.rationale,
          sourceId: item.sourceId,
          status: "DRAFT",
          origin: "ai",
          agentRunId,
          createdAt: now,
          updatedAt: now,
          approvedBy: null,
          approvedAt: null,
        });
      }

      state.questions = state.questions.filter((q) => !(mine(q) && q.state === "open"));
      const asked = new Set(state.questions.filter(mine).map((q) => normalize(q.question)));
      for (const q of output.questions) {
        const key = normalize(q.question);
        if (asked.has(key)) continue;
        asked.add(key);
        state.questions.push({
          id: newId(),
          ...owner,
          question: q.question,
          reason: q.reason,
          state: "open",
          answer: null,
          agentRunId,
          createdAt: now,
          resolvedAt: null,
        });
      }

      const previous = state.discoveries.find(mine);
      const discovery: Discovery = {
        ...owner,
        agentRunId,
        runCount: (previous?.runCount ?? 0) + 1,
        summary: output.summary,
        actors: output.actors,
        goals: output.goals,
        constraints: output.constraints,
        conflicts: output.conflicts,
        ambiguities: output.ambiguities,
        status: "draft",
        updatedAt: now,
        confirmedBy: null,
        confirmedAt: null,
      };
      state.discoveries = [...state.discoveries.filter((d) => !mine(d)), discovery];
      return discovery;
    });
  },

  async confirm(scope, projectId, by, at) {
    return transact((state) => {
      const row = state.discoveries.find(scoped(scope.workspace.id, projectId));
      if (!row) return null;
      Object.assign(row, { status: "confirmed", confirmedBy: by, confirmedAt: at, updatedAt: at });
      return { ...row };
    });
  },
};
