import { z } from "zod";

import { LLMError, type LLMClient, type StructuredRequest, type StructuredResult } from "./types";

const ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const TIMEOUT_MS = 60_000;

type Options = {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
};

type ResponsesApiBody = {
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

/**
 * Whether to send `temperature` to a model. The gpt-5 and o-series reasoning models accept only the
 * default, so sending it would fail the request.
 */
export function supportsTemperature(model: string): boolean {
  return !model.startsWith("gpt-5") && !/^o\d/.test(model);
}

/** First text block of a Responses API result. */
export function extractOutputText(body: ResponsesApiBody): string | null {
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return null;
}

/**
 * OpenAI Responses API with Structured Outputs (ADR-004). Server-only: the key never reaches the
 * browser (CLAUDE.md §7.1). 60 s timeout; one retry on 429 and 5xx (PF-020).
 */
export function createOpenAIClient(options: Options): LLMClient {
  const model = options.model || DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 1_000;

  async function call(body: unknown): Promise<ResponsesApiBody> {
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const timedOut = (err as Error).name === "AbortError";
        if (attempt === 1 && !timedOut) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        throw new LLMError(
          timedOut ? "The model took too long to respond" : "Couldn't reach the model provider",
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt === 1) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      const json = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      if (!response.ok) {
        throw new LLMError(
          `Model provider error (${response.status}): ${json.error?.message ?? "unknown"}`,
          retryable,
        );
      }
      return json;
    }
  }

  return {
    provider: "openai",
    model,
    async generateStructured<T extends z.ZodType>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult> {
      const started = Date.now();
      const input = [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
        ...(request.feedback?.length
          ? [
              {
                role: "user",
                content: `Your previous output failed validation. Fix these problems and return the full JSON again:\n- ${request.feedback.join("\n- ")}`,
              },
            ]
          : []),
      ];
      const used = request.model ?? model;
      const body = await call({
        model: used,
        input,
        ...(request.temperature !== undefined && supportsTemperature(used)
          ? { temperature: request.temperature }
          : {}),
        text: {
          format: {
            type: "json_schema",
            name: request.name,
            schema: z.toJSONSchema(request.schema),
            strict: false,
          },
        },
      });

      const text = extractOutputText(body);
      if (text === null) throw new LLMError("The model returned no text output");
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text; // the runner reports it as a validation failure and retries
      }
      return {
        data,
        usage: {
          tokensIn: body.usage?.input_tokens ?? 0,
          tokensOut: body.usage?.output_tokens ?? 0,
        },
        costUsd: null,
        latencyMs: Date.now() - started,
        provider: "openai",
        model: request.model ?? model,
      };
    },
  };
}
