import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LLMClient, StructuredRequest } from "@/src/ai/types";
import { tokenLines } from "@/tests/ai-evals/report";
import {
  DEFAULT_EVAL_TOKEN_CAP,
  TokenCapReached,
  cappedEvalClient,
  evalTokenCap,
  fileLedger,
  isTokenCapReached,
  memoryLedger,
  withTokenCap,
} from "@/tests/ai-evals/token-cap";

/** A model that reports `tokensIn` + `tokensOut` per call and counts its calls. */
function fakeModel(provider = "openai", tokensIn = 60, tokensOut = 40) {
  let calls = 0;
  const llm: LLMClient = {
    provider,
    model: "test-model",
    async generateStructured() {
      calls += 1;
      return {
        data: {},
        usage: { tokensIn, tokensOut },
        costUsd: null,
        latencyMs: 1,
        provider,
        model: "test-model",
      };
    },
  };
  return { llm, calls: () => calls };
}

const request = {
  name: "discovery",
  system: "s",
  prompt: "p",
  data: {},
} as unknown as StructuredRequest<never>;
const usageFile = () => join(mkdtempSync(join(tmpdir(), "pf-eval-cap-")), "usage.log");

describe("evalTokenCap", () => {
  it("reads EVAL_TOKEN_CAP and falls back to the default for missing or junk values", () => {
    expect(evalTokenCap({ EVAL_TOKEN_CAP: "250000" })).toBe(250_000);
    expect(evalTokenCap({})).toBe(DEFAULT_EVAL_TOKEN_CAP);
    for (const junk of ["0", "-5", "lots", ""])
      expect(evalTokenCap({ EVAL_TOKEN_CAP: junk })).toBe(DEFAULT_EVAL_TOKEN_CAP);
  });
});

describe("withTokenCap", () => {
  it("passes calls through and counts tokens in + out while under the cap", async () => {
    const { llm, calls } = fakeModel();
    const ledger = memoryLedger();
    const capped = withTokenCap(llm, 1000, ledger);
    await capped.generateStructured(request);
    await capped.generateStructured(request);
    expect(calls()).toBe(2);
    expect(ledger.used()).toBe(200);
    expect(capped.provider).toBe("openai");
  });

  it("refuses the next call once the cap is reached, without calling the model", async () => {
    const { llm, calls } = fakeModel();
    const capped = withTokenCap(llm, 200, memoryLedger());
    await capped.generateStructured(request);
    await capped.generateStructured(request); // reaches exactly 200
    let error: unknown = null;
    try {
      await capped.generateStructured(request);
    } catch (err) {
      error = err;
    }
    expect(isTokenCapReached(error)).toBe(true);
    expect((error as TokenCapReached).used).toBe(200);
    expect((error as TokenCapReached).message).toContain("Raise EVAL_TOKEN_CAP");
    expect(calls()).toBe(2);
  });
});

describe("fileLedger", () => {
  it("adds up every worker's usage in one shared file", () => {
    const file = usageFile();
    const workerA = fileLedger(file);
    const workerB = fileLedger(file);
    workerA.add(120);
    workerB.add(80);
    expect(workerA.used()).toBe(200);
    expect(workerB.used()).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("120\n80\n");
  });

  it("counts zero before the file exists", () => {
    expect(fileLedger(usageFile()).used()).toBe(0);
  });

  it("stops a second eval file once the first has used the run's cap", async () => {
    const file = usageFile();
    const env = { EVAL_TOKEN_CAP: "150" };
    const first = cappedEvalClient(fakeModel().llm, file, env);
    const second = cappedEvalClient(fakeModel().llm, file, env);
    await first.llm.generateStructured(request); // 100
    await second.llm.generateStructured(request); // 200: over the cap
    let error: unknown = null;
    try {
      await first.llm.generateStructured(request);
    } catch (err) {
      error = err;
    }
    expect(isTokenCapReached(error)).toBe(true);
    expect(first.tokens()).toEqual({ used: 200, cap: 150 });
  });
});

describe("cappedEvalClient", () => {
  it("never caps the demo engine but still counts its tokens", async () => {
    const { llm, calls } = fakeModel("demo");
    const capped = cappedEvalClient(llm, undefined, { EVAL_TOKEN_CAP: "1" });
    await capped.llm.generateStructured(request);
    await capped.llm.generateStructured(request);
    expect(calls()).toBe(2);
    expect(capped.tokens()).toEqual({ used: 200, cap: null });
  });
});

describe("tokenLines", () => {
  it("states usage against the cap", () => {
    expect(tokenLines({ used: 412_300, cap: 1_000_000 }, null)[0]).toBe(
      "Tokens used by this eval run: 412,300 of the 1,000,000 cap (`EVAL_TOKEN_CAP`).",
    );
  });

  it("says when the demo engine ran without a cap", () => {
    expect(tokenLines({ used: 900, cap: null }, null)[0]).toContain("demo engine, no cap");
  });

  it("explains an early stop and how to run the rest", () => {
    const text = tokenLines({ used: 1_000_400, cap: 1_000_000 }, { done: 12, total: 20 }).join(
      "\n",
    );
    expect(text).toContain("Stopped early: the token cap was reached after 12 of 20 fixtures.");
    expect(text).toContain("Raise `EVAL_TOKEN_CAP` to run the rest.");
  });

  it("adds nothing when the report has no token data", () => {
    expect(tokenLines(undefined, null)).toEqual([]);
  });
});
