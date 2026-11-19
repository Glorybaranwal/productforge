import { readFile } from "node:fs/promises";
import { join } from "node:path";

const cache = new Map<string, string>();

/**
 * Loads a versioned system prompt from src/ai/prompts (CLAUDE.md §8: `<stage>.v<N>.md`).
 * Server-only. next.config.ts traces these files into the deployment.
 */
export async function loadPrompt(file: string): Promise<string> {
  if (!/^[a-z-]+\.v\d+\.md$/.test(file)) throw new Error(`Invalid prompt file name: ${file}`);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const text = await readFile(join(process.cwd(), "src", "ai", "prompts", file), "utf8");
  cache.set(file, text);
  return text;
}
