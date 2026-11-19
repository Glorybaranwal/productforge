import { createDemoClient } from "./demo/demo-client";
import { createOpenAIClient } from "./openai-client";
import type { LLMClient } from "./types";

export { estimateTokens, LLMError } from "./types";
export type { LLMClient, StructuredRequest, StructuredResult } from "./types";

let override: LLMClient | undefined;

/** Swap the client (tests, previews). Pass undefined to restore the default. */
export function setLLMClient(client: LLMClient | undefined): void {
  override = client;
}

/**
 * OpenAI when OPENAI_API_KEY is set (server only), otherwise the deterministic demo engine
 * (ADR-011). AI_PROVIDER=demo forces the demo engine even with a key.
 */
export function getLLMClient(): LLMClient {
  if (override) return override;
  const env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {};
  if (env.OPENAI_API_KEY && env.AI_PROVIDER !== "demo") {
    return createOpenAIClient({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
  }
  return createDemoClient();
}
