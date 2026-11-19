import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json.
    alias: { "@": root },
  },
  test: {
    // Server code is the majority, so tests run in Node by default.
    // Component tests opt into a DOM with a `// @vitest-environment jsdom` first line.
    environment: "node",
    // Lets Testing Library register its automatic cleanup after each test.
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
});
