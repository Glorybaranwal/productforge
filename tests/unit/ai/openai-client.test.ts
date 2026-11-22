import { z } from "zod";
import { describe, expect, it } from "vitest";

import { LLMError } from "@/src/ai/llm-client";
import { createOpenAIClient, extractOutputText } from "@/src/ai/openai-client";

const schema = z.object({ answer: z.string() });

function responsesBody(text: string) {
  return {
    output: [
      { type: "reasoning", content: [] },
      { type: "message", content: [{ type: "output_text", text }] },
    ],
    usage: { input_tokens: 120, output_tokens: 30 },
  };
}

/** fetch stub returning the given (status, body) pairs in order; records request bodies. */
function stubFetch(replies: [number, unknown][]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const [status, body] = replies.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

const request = { name: "discovery", system: "sys", prompt: "user text", data: {}, schema };

describe("OpenAI client", () => {
  it("sends a structured-output request and returns the parsed JSON with usage", async () => {
    const { fetchImpl, bodies } = stubFetch([[200, responsesBody('{"answer":"42"}')]]);
    const client = createOpenAIClient({
      apiKey: "sk-test",
      model: "test-model",
      fetchImpl,
      retryDelayMs: 0,
    });

    const result = await client.generateStructured(request);

    expect(result.data).toEqual({ answer: "42" });
    expect(result.usage).toEqual({ tokensIn: 120, tokensOut: 30 });
    expect(result.model).toBe("test-model");
    const body = bodies[0] as { model: string; text: { format: { type: string; name: string } } };
    expect(body.model).toBe("test-model");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.name).toBe("discovery");
  });

  it("includes validation feedback from a previous attempt", async () => {
    const { fetchImpl, bodies } = stubFetch([[200, responsesBody('{"answer":"ok"}')]]);
    const client = createOpenAIClient({ apiKey: "sk-test", fetchImpl, retryDelayMs: 0 });
    await client.generateStructured({ ...request, feedback: ["answer: Required"] });
    const input = (bodies[0] as { input: { content: string }[] }).input;
    expect(input.at(-1)?.content).toContain("answer: Required");
  });

  it("retries once on 429, then succeeds", async () => {
    const { fetchImpl, bodies } = stubFetch([
      [429, { error: { message: "rate limited" } }],
      [200, responsesBody('{"answer":"after retry"}')],
    ]);
    const client = createOpenAIClient({ apiKey: "sk-test", fetchImpl, retryDelayMs: 0 });
    const result = await client.generateStructured(request);
    expect(result.data).toEqual({ answer: "after retry" });
    expect(bodies).toHaveLength(2);
  });

  it("throws an LLMError on a 400 without retrying", async () => {
    const { fetchImpl, bodies } = stubFetch([[400, { error: { message: "bad schema" } }]]);
    const client = createOpenAIClient({ apiKey: "sk-test", fetchImpl, retryDelayMs: 0 });
    try {
      await client.generateStructured(request);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      expect((err as LLMError).message).toContain("bad schema");
    }
    expect(bodies).toHaveLength(1);
  });

  it("finds the output text in a Responses API body", () => {
    expect(extractOutputText(responsesBody("hi"))).toBe("hi");
    expect(extractOutputText({ output: [] })).toBeNull();
  });

  it("sends temperature only to models that accept it", async () => {
    for (const [model, expected] of [
      ["gpt-4.1", true],
      ["gpt-5-mini", false],
    ] as const) {
      const { fetchImpl, bodies } = stubFetch([[200, responsesBody('{"answer":"1"}')]]);
      const client = createOpenAIClient({ apiKey: "sk-test", model, fetchImpl });
      await client.generateStructured({ ...request, temperature: 0 });
      expect("temperature" in bodies[0]!).toBe(expected);
    }
  });
});
