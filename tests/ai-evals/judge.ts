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

const MAX_REASON = 200;

/** One verdict at a time, so a single malformed verdict voids only itself. A long reason is cut, not rejected. */
function parseVerdicts(data: unknown): JudgeVerdict[] | null {
  const list = (data as { verdicts?: unknown } | null)?.verdicts;
  if (!Array.isArray(list)) return null;
  return list.flatMap((raw) => {
    const v =
      raw && typeof raw === "object" && typeof (raw as { reason?: unknown }).reason === "string"
        ? { ...raw, reason: (raw as { reason: string }).reason.slice(0, MAX_REASON) }
        : raw;
    const parsed = JudgeVerdict.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

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
  if (items.length === 0) return misses.map((m) => noMatch(m, "no output items to match"));
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
    verdicts = parseVerdicts(result.data);
  } catch {
    verdicts = null;
  }
  if (!verdicts) return misses.map((m) => noMatch(m));

  const ids = new Set(items.map((i) => i.id));
  return misses.map((phrase, index) => {
    const v =
      verdicts.find((x) => clean(x.phrase) === clean(phrase)) ??
      (verdicts.length === misses.length ? verdicts[index] : undefined);
    if (!v) return noMatch(phrase);
    if (!v.match) return { ...v, phrase, outputItemId: null };
    if (v.outputItemId === null || !ids.has(v.outputItemId)) return noMatch(phrase);
    return { ...v, phrase };
  });
}
