/** ADR-010 Tier 2: an LLM judge for expected phrases Tier 1 (content-word match) missed. */
import { z } from "zod";

import type { LLMClient } from "@/src/ai/types";

export const JUDGE_PROMPT_VERSION = "judge.v1";

export const JudgeVerdict = z.object({
  phrase: z.string(),
  match: z.boolean(),
  outputItemId: z.string().nullable(),
  reason: z.string().max(200),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const JudgeOutput = z.object({ verdicts: z.array(JudgeVerdict) });

export type JudgeItem = { id: string; text: string };

const INVALID = "judge output invalid";

const noMatch = (phrase: string, reason = INVALID): JudgeVerdict => ({
  phrase,
  match: false,
  outputItemId: null,
  reason,
});

/** Keeps untrusted text from closing or opening a delimited block. */
const clean = (text: string) => text.replace(/</g, "&lt;").replace(/\s+/g, " ").trim();

export function renderJudgePrompt(misses: string[], items: JudgeItem[]): string {
  return [
    "Judge each expected phrase against the output items.",
    "<expected_phrases>",
    ...misses.map((m) => `- ${clean(m)}`),
    "</expected_phrases>",
    "<output_items>",
    ...items.map((i) => `[${i.id}] ${clean(i.text)}`),
    "</output_items>",
  ].join("\n");
}

/**
 * One model call for all `misses` of one list in one fixture. Never throws: an unusable answer is
 * "no match, judge output invalid", so a flaky judge can only lower recall, never crash the eval.
 */
export async function judgeMisses(
  llm: LLMClient,
  system: string,
  misses: string[],
  items: JudgeItem[],
): Promise<JudgeVerdict[]> {
  if (misses.length === 0) return [];
  let verdicts: JudgeVerdict[] | null = null;
  try {
    const result = await llm.generateStructured({
      name: "eval-judge",
      system,
      prompt: renderJudgePrompt(misses, items),
      data: { misses, items },
      schema: JudgeOutput,
      temperature: 0,
    });
    const parsed = JudgeOutput.safeParse(result.data);
    if (parsed.success) verdicts = parsed.data.verdicts;
  } catch {
    verdicts = null;
  }
  if (!verdicts) return misses.map((m) => noMatch(m));

  const ids = new Set(items.map((i) => i.id));
  return misses.map((phrase, index) => {
    const v =
      verdicts.find((x) => x.phrase.trim() === phrase.trim()) ??
      (verdicts.length === misses.length ? verdicts[index] : undefined);
    if (!v) return noMatch(phrase);
    if (!v.match) return { ...v, phrase, outputItemId: null };
    if (v.outputItemId === null || !ids.has(v.outputItemId)) return noMatch(phrase);
    return { ...v, phrase };
  });
}
