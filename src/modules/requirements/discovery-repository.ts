import { readState, transact } from "@/src/db/store";
import { newId, nowIso } from "@/src/lib/ids";
import { normalize } from "@/src/lib/text";

import { nextCode } from "./repository";
import type { Discovery, DiscoveryOutput, Requirement } from "./schema";

type Owner = { workspaceId: string; projectId: string };

export const discoveryRepository = {
  async get(workspaceId: string, projectId: string): Promise<Discovery | null> {
    const state = await readState();
    return (
      state.discoveries.find((d) => d.workspaceId === workspaceId && d.projectId === projectId) ??
      null
    );
  },

  /**
   * Saves a successful discovery run in one transaction:
   * - untouched AI drafts from earlier runs are replaced by the new ones;
   * - the user's work is kept: approved, rejected, human-added and edited requirements, and every
   *   resolved question (new items that duplicate them are skipped);
   * - open questions from earlier runs are replaced by the new open questions.
   */
  async applyRun(owner: Owner, output: DiscoveryOutput, agentRunId: string): Promise<Discovery> {
    const now = nowIso();
    return transact((state) => {
      const mine = (r: Owner) =>
        r.workspaceId === owner.workspaceId && r.projectId === owner.projectId;
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

  async confirm(owner: Owner, by: string, at: string): Promise<Discovery | null> {
    return transact((state) => {
      const row = state.discoveries.find(
        (d) => d.workspaceId === owner.workspaceId && d.projectId === owner.projectId,
      );
      if (!row) return null;
      Object.assign(row, { status: "confirmed", confirmedBy: by, confirmedAt: at, updatedAt: at });
      return { ...row };
    });
  },
};
