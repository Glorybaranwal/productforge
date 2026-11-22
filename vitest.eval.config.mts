import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/** `pnpm eval`: AI evals (ADR-010). Calls the configured model, so it's kept out of `pnpm test`. */
export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    environment: "node",
    include: ["tests/ai-evals/**/*.eval.ts"],
    // One token-usage log per run, shared by every eval file (ADR-010 cost guard).
    globalSetup: ["tests/ai-evals/global-setup.ts"],
    testTimeout: 600_000,
  },
});
