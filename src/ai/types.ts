import type { z } from "zod";

/**
 * Provider-agnostic model request (ADR-004). `prompt` is the rendered user message with untrusted
 * text in delimited blocks; `data` is the same input as structured data, used by the demo engine.
 */
export type StructuredRequest<T extends z.ZodType> = {
  /** Stage name; also the JSON schema name sent to the provider. */
  name: string;
  system: string;
  prompt: string;
  data: unknown;
  schema: T;
  /** Validation errors from a previous attempt, so the model can fix them. */
  feedback?: string[];
  model?: string;
  /** Sampling temperature. Omitted (provider default) unless set; some models reject it. */
  temperature?: number;
};

export type StructuredResult = {
  /** Raw, unvalidated model output: the stage runner validates it. */
  data: unknown;
  usage: { tokensIn: number; tokensOut: number };
  costUsd: number | null;
  latencyMs: number;
  provider: string;
  model: string;
};

export interface LLMClient {
  readonly provider: string;
  readonly model: string;
  generateStructured<T extends z.ZodType>(request: StructuredRequest<T>): Promise<StructuredResult>;
}

export class LLMError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "LLMError";
    this.retryable = retryable;
  }
}

/** Rough token estimate for providers that don't report usage (≈4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
