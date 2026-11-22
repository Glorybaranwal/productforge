import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_name` marks a deliberately unused binding; `{ omit, ...rest }` is how we drop a field.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  // Architecture rules from CLAUDE.md §6–7, checked by the linter (ADR-035).
  {
    files: ["app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/src/db/*",
                "**/repository",
                "**/*-repository",
                "@/src/ai/stages/*",
                "openai",
              ],
              message: "Route handlers stay thin: call a module's service (CLAUDE.md §6).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["components/**/*.{ts,tsx}", "app/**/page.tsx", "app/**/layout.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // The rule checkers are pure functions the editors reuse for live hints.
              regex: "^(@/src/ai/(?!orchestrator/rules$)|openai$)",
              allowTypeImports: true,
              message:
                "Never call the model from the browser: AI runs on the server (CLAUDE.md §7.1).",
            },
            {
              group: ["@/src/db/*", "**/repository", "**/*-repository"],
              allowTypeImports: true,
              message: "UI reads data through services or the API, never the DB.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Must stay last: turns off stylistic rules that would fight Prettier.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "tests/ai-evals/reports/**",
  ]),
]);

export default eslintConfig;
