import type { z } from "zod";

import { getLLMClient, LLMError, type LLMClient } from "@/src/ai/llm-client";
import { loadPrompt } from "@/src/ai/prompts/load";
import { zodFieldErrors } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import { sha256 } from "@/src/lib/text";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun, RunEvent, StageName } from "@/src/modules/agent-runs/schema";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

export type StageContext = { ctx: WorkspaceContext; projectId: string };

/** A fixed pipeline step (ADR-002): context → model → validate → rules → persist. */
export type Stage<I, O> = {
  name: StageName;
  promptFile: string;
  outputSchema: z.ZodType<O>;
  loadContext(sc: StageContext): Promise<I>;
  /** The user message: untrusted text in clearly delimited blocks (CLAUDE.md §7.8). */
  renderPrompt(input: I): string;
  /** Each returns human-readable violations; an empty array means the rule passed. */
  businessRules: ((output: O, input: I) => string[])[];
  /** Saves the validated output as DRAFT rows linked to the run. */
  persist(output: O, input: I, sc: StageContext, run: AgentRun): Promise<void>;
};

export type StageDeps = { llm?: LLMClient; loadSystemPrompt?: (file: string) => Promise<string> };

const MAX_ATTEMPTS = 2; // first try + one retry with the validation errors (CLAUDE.md §7.2)

/**
 * Runs one stage and logs it as an agent run. Never throws for model or validation failures:
 * the returned run has status "failed" and an error message. Errors from loadContext (e.g. "no
 * sources") are rethrown so the API can return them as 4xx.
 */
export async function runStage<I, O>(
  stage: Stage<I, O>,
  sc: StageContext,
  deps: StageDeps = {},
): Promise<AgentRun> {
  const llm = deps.llm ?? getLLMClient();
  const events: RunEvent[] = [];
  const log = (step: RunEvent["step"], message: string) =>
    events.push({ at: nowIso(), step, message });

  const input = await stage.loadContext(sc);
  const system = await (deps.loadSystemPrompt ?? loadPrompt)(stage.promptFile);
  const prompt = stage.renderPrompt(input);
  log("started", `Running ${stage.name} with ${llm.provider}/${llm.model}`);
  log("context", `Prepared ${prompt.length.toLocaleString("en")} characters of input`);

  let run = await agentRunRepository.insert({
    id: newId(),
    workspaceId: sc.ctx.workspace.id,
    projectId: sc.projectId,
    stage: stage.name,
    provider: llm.provider,
    model: llm.model,
    promptVersion: stage.promptFile,
    status: "running",
    attempts: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    latencyMs: 0,
    inputHash: await sha256(system + prompt),
    error: null,
    events: [...events],
    createdBy: sc.ctx.session.userId,
    createdAt: nowIso(),
    finishedAt: null,
  });

  const totals = {
    attempts: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0 as number | null,
    latencyMs: 0,
  };
  const finish = async (status: "succeeded" | "failed", error: string | null) => {
    log(status, error ?? "Saved as drafts for review");
    run =
      (await agentRunRepository.update(run.workspaceId, run.id, {
        ...totals,
        status,
        error,
        events: [...events],
        finishedAt: nowIso(),
      })) ?? run;
    if (status === "failed")
      logger.warn("Stage failed", { stage: stage.name, runId: run.id, error });
    return run;
  };

  try {
    let feedback: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      totals.attempts = attempt;
      log("model", `Attempt ${attempt}: asking the model`);
      const result = await llm.generateStructured({
        name: stage.name,
        system,
        prompt,
        data: input,
        schema: stage.outputSchema,
        feedback,
      });
      totals.tokensIn += result.usage.tokensIn;
      totals.tokensOut += result.usage.tokensOut;
      totals.latencyMs += result.latencyMs;
      totals.costUsd =
        totals.costUsd === null || result.costUsd === null ? null : totals.costUsd + result.costUsd;

      const parsed = stage.outputSchema.safeParse(result.data);
      const problems = parsed.success
        ? stage.businessRules.flatMap((rule) => rule(parsed.data, input))
        : zodFieldErrors(parsed.error).map((e) => `${e.path || "output"}: ${e.message}`);

      if (parsed.success && problems.length === 0) {
        log("validate", "Output matches the schema and passes the business rules");
        await stage.persist(parsed.data, input, sc, run);
        log("persist", "Saved results as drafts");
        return await finish("succeeded", null);
      }
      feedback = problems.slice(0, 20);
      log(
        attempt < MAX_ATTEMPTS ? "retry" : "validate",
        `${problems.length} problem(s): ${feedback.slice(0, 3).join("; ")}`,
      );
    }
    return await finish(
      "failed",
      `The model's output failed validation twice: ${feedback?.slice(0, 3).join("; ")}`,
    );
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "The AI step failed unexpectedly";
    if (!(err instanceof LLMError))
      logger.error("Stage crashed", { stage: stage.name, error: String(err) });
    return await finish("failed", message);
  }
}
