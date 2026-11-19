import { z } from "zod";

/** Model stages. Sprint planning is deterministic (ADR-017); "impact" explains a change (PF-053). */
export const STAGES = ["discovery", "prd", "story", "qa", "task", "impact"] as const;
export type StageName = (typeof STAGES)[number];

export const RunEvent = z.object({
  at: z.iso.datetime(),
  step: z.enum([
    "started",
    "context",
    "model",
    "validate",
    "retry",
    "persist",
    "succeeded",
    "failed",
  ]),
  message: z.string(),
});
export type RunEvent = z.infer<typeof RunEvent>;

/** One AI stage execution (CLAUDE.md §7: every AI call is logged). */
export const AgentRun = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  stage: z.enum(STAGES),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  attempts: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  /** Null when the provider's pricing isn't configured (demo engine is free: 0). */
  costUsd: z.number().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
  inputHash: z.string(),
  error: z.string().nullable(),
  events: z.array(RunEvent),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const IdempotencyRecord = z.object({
  workspaceId: z.uuid(),
  scope: z.string(),
  key: z.string(),
  resultId: z.string(),
  createdAt: z.iso.datetime(),
});
export type IdempotencyRecord = z.infer<typeof IdempotencyRecord>;
