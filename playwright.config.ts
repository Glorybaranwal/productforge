import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys from the test plan (J1–J8, PF-060). Runs the app in demo mode: demo sign-in,
 * in-memory data and the demo AI engine, so no secrets and no tokens are needed.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  // `next dev` compiles each route on first hit; the default 5 s is too tight for that.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Node runs Next directly, so it works whether pnpm is installed or only reached through corepack.
    command: `node node_modules/next/dist/bin/next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/dashboard`,
    // Never reuse a running server: it may hold real data, and the specs create projects.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { AUTH_DRIVER: "demo", DATA_DRIVER: "memory", AI_PROVIDER: "demo" },
  },
});
