import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys from the test plan (J1–J8, PF-060). Runs the app in demo mode: demo sign-in,
 * in-memory data and the demo AI engine, so no secrets and no tokens are needed.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/dashboard`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { AUTH_DRIVER: "demo", DATA_DRIVER: "memory", AI_PROVIDER: "demo" },
  },
});
