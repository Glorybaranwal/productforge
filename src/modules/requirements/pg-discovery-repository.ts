import { and, eq, sql } from "drizzle-orm";

import { clarifyingQuestions, discoveries, requirements } from "@/src/db/schema";
import { inUserTx, iso, isUuid, lockProject } from "@/src/db/scope";
import { normalize } from "@/src/lib/text";

import { nextCode } from "./codes";
import type { DiscoveryRepository } from "./discovery-repository";
import type { Discovery } from "./schema";

const toDiscovery = (d: typeof discoveries.$inferSelect): Discovery => ({
  projectId: d.projectId,
  workspaceId: d.workspaceId,
  agentRunId: d.agentRunId,
  runCount: d.runCount,
  summary: d.summary,
  actors: d.actors,
  goals: d.goals,
  constraints: d.constraints,
  conflicts: d.conflicts,
  ambiguities: d.ambiguities,
  status: d.status,
  updatedAt: d.updatedAt.toISOString(),
  confirmedBy: d.confirmedBy,
  confirmedAt: iso(d.confirmedAt),
});

/** Supabase Postgres, as the signed-in user (PF-070, ADR-026). */
export const pgDiscovery: DiscoveryRepository = {
  get: (scope, projectId) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return null;
      const [row] = await tx
        .select()
        .from(discoveries)
        .where(
          and(
            eq(discoveries.workspaceId, scope.workspace.id),
            eq(discoveries.projectId, projectId),
          ),
        )
        .limit(1);
      return row ? toDiscovery(row) : null;
    }),

  // One transaction, under the project lock: replace AI drafts, add new requirements with the next
  // codes, replace open questions, save the summary. Rows saved together get consecutive
  // timestamps so they keep the model's order.
  applyRun: (scope, projectId, output, agentRunId) =>
    inUserTx(scope, async (tx) => {
      const workspaceId = scope.workspace.id;
      const base = Date.now();
      await lockProject(tx, projectId);

      const ownRequirements = and(
        eq(requirements.workspaceId, workspaceId),
        eq(requirements.projectId, projectId),
      );
      await tx
        .delete(requirements)
        .where(
          and(ownRequirements, eq(requirements.status, "DRAFT"), eq(requirements.origin, "ai")),
        );
      const kept = await tx
        .select({ code: requirements.code, text: requirements.text })
        .from(requirements)
        .where(ownRequirements);
      const seen = new Set(kept.map((r) => normalize(r.text)));
      const codes = kept.map((r) => ({ code: r.code }));
      const newRequirements: (typeof requirements.$inferInsert)[] = [];
      for (const item of output.requirements) {
        const key = normalize(item.text);
        if (seen.has(key)) continue;
        seen.add(key);
        const code = nextCode(codes, item.type);
        codes.push({ code });
        const at = new Date(base + newRequirements.length);
        newRequirements.push({
          workspaceId,
          projectId,
          code,
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
          createdAt: at,
          updatedAt: at,
        });
      }
      if (newRequirements.length) await tx.insert(requirements).values(newRequirements);

      const ownQuestions = and(
        eq(clarifyingQuestions.workspaceId, workspaceId),
        eq(clarifyingQuestions.projectId, projectId),
      );
      await tx
        .delete(clarifyingQuestions)
        .where(and(ownQuestions, eq(clarifyingQuestions.state, "open")));
      const resolved = await tx
        .select({ question: clarifyingQuestions.question })
        .from(clarifyingQuestions)
        .where(ownQuestions);
      const asked = new Set(resolved.map((q) => normalize(q.question)));
      const newQuestions: (typeof clarifyingQuestions.$inferInsert)[] = [];
      for (const q of output.questions) {
        const key = normalize(q.question);
        if (asked.has(key)) continue;
        asked.add(key);
        newQuestions.push({
          workspaceId,
          projectId,
          question: q.question,
          reason: q.reason,
          state: "open",
          answer: null,
          agentRunId,
          createdAt: new Date(base + newQuestions.length),
          resolvedAt: null,
        });
      }
      if (newQuestions.length) await tx.insert(clarifyingQuestions).values(newQuestions);

      const result = {
        agentRunId,
        summary: output.summary,
        actors: output.actors,
        goals: output.goals,
        constraints: output.constraints,
        conflicts: output.conflicts,
        ambiguities: output.ambiguities,
        status: "draft" as const,
        updatedAt: new Date(base),
        confirmedBy: null,
        confirmedAt: null,
      };
      const [row] = await tx
        .insert(discoveries)
        .values({ projectId, workspaceId, runCount: 1, ...result })
        .onConflictDoUpdate({
          target: discoveries.projectId,
          set: { ...result, runCount: sql`${discoveries.runCount} + 1` },
        })
        .returning();
      return toDiscovery(row!);
    }),

  confirm: (scope, projectId, by, at) =>
    inUserTx(scope, async (tx) => {
      if (!isUuid(projectId)) return null;
      const when = new Date(at);
      const [row] = await tx
        .update(discoveries)
        .set({ status: "confirmed", confirmedBy: by, confirmedAt: when, updatedAt: when })
        .where(
          and(
            eq(discoveries.workspaceId, scope.workspace.id),
            eq(discoveries.projectId, projectId),
          ),
        )
        .returning();
      return row ? toDiscovery(row) : null;
    }),
};
