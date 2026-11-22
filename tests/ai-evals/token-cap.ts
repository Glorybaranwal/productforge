/**
 * ADR-010 cost guard: one token cap for a whole `pnpm eval` run. Every eval file wraps its model client
 * with `cappedEvalClient`; all of them write to one usage log, so the cap holds across Vitest's
 * parallel workers. A call is refused once the run has used the cap; calls already in flight finish,
 * so a run can pass the cap by at most one call per worker.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import type { LLMClient } from "@/src/ai/types";

/** Tokens (in + out) one `pnpm eval` run may use, when `EVAL_TOKEN_CAP` doesn't say. */
export const DEFAULT_EVAL_TOKEN_CAP = 1_000_000;

type Env = Record<string, string | undefined>;

export function evalTokenCap(env: Env = process.env): number {
  const raw = env.EVAL_TOKEN_CAP;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_EVAL_TOKEN_CAP;
}

export class TokenCapReached extends Error {
  readonly used: number;
  readonly cap: number;
  constructor(used: number, cap: number) {
    super(
      `Eval stopped: the token cap was reached (${used.toLocaleString("en")} of ` +
        `${cap.toLocaleString("en")} tokens). Raise EVAL_TOKEN_CAP to run the rest.`,
    );
    this.name = "TokenCapReached";
    this.used = used;
    this.cap = cap;
  }
}

export const isTokenCapReached = (err: unknown): err is TokenCapReached =>
  err instanceof TokenCapReached;

/** Where a run's token usage is counted. */
export interface UsageLedger {
  used(): number;
  add(tokens: number): void;
}

export function memoryLedger(): UsageLedger {
  let total = 0;
  return { used: () => total, add: (n) => void (total += n) };
}

/** One line per call, appended: small appends don't interleave, so parallel workers can share it. */
export function fileLedger(path: string): UsageLedger {
  return {
    used: () =>
      existsSync(path)
        ? readFileSync(path, "utf8")
            .split("\n")
            .reduce((sum, line) => sum + (Number(line) || 0), 0)
        : 0,
    add: (n) => appendFileSync(path, `${n}\n`),
  };
}

/** The same client, refusing calls once the ledger has reached `cap`. */
export function withTokenCap(llm: LLMClient, cap: number, ledger: UsageLedger): LLMClient {
  return {
    provider: llm.provider,
    model: llm.model,
    async generateStructured(request) {
      const used = ledger.used();
      if (used >= cap) throw new TokenCapReached(used, cap);
      const result = await llm.generateStructured(request);
      ledger.add(result.usage.tokensIn + result.usage.tokensOut);
      return result;
    },
  };
}

/** What a report says about tokens: the cap is null for the demo engine, which costs nothing. */
export type TokenUse = { used: number; cap: number | null };

export type CappedEval = { llm: LLMClient; tokens: () => TokenUse };

/**
 * The client an eval file uses. `usageFile` comes from the eval global setup (`inject`); without it
 * (one file run on its own) the count is kept in memory for that file. The demo engine is not capped.
 */
export function cappedEvalClient(
  llm: LLMClient,
  usageFile?: string,
  env: Env = process.env,
): CappedEval {
  const ledger = usageFile ? fileLedger(usageFile) : memoryLedger();
  if (llm.provider === "demo") {
    const counted: LLMClient = {
      provider: llm.provider,
      model: llm.model,
      async generateStructured(request) {
        const result = await llm.generateStructured(request);
        ledger.add(result.usage.tokensIn + result.usage.tokensOut);
        return result;
      },
    };
    return { llm: counted, tokens: () => ({ used: ledger.used(), cap: null }) };
  }
  const cap = evalTokenCap(env);
  return { llm: withTokenCap(llm, cap, ledger), tokens: () => ({ used: ledger.used(), cap }) };
}
