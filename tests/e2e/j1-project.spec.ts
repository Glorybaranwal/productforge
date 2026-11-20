import { expect, test } from "@playwright/test";

import { createProject } from "./helpers";

test.describe("J1 · create a project", () => {
  test("creates a project and lists it on the dashboard", async ({ page }) => {
    const name = `E2E list ${Date.now()}`;
    await createProject(page, name);
    await page.goto("/dashboard");
    await expect(page.getByText(name)).toBeVisible();
  });

  test("dumb user: empty and whitespace-only names are refused next to the field", async ({
    page,
  }) => {
    await page.goto("/dashboard/projects/new");
    await page.getByLabel("Project name").fill("   ");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(/at least 2 characters/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/new$/);
  });

  test("dumb user: a double-click on Create makes one project", async ({ page }) => {
    const name = `E2E once ${Date.now()}`;
    await page.goto("/dashboard/projects/new");
    await page.getByLabel("Project name").fill(name);
    await page.getByLabel("Domain").fill("Fintech");
    await page.getByLabel("Audience").fill("Retail banking customers");
    await page.getByRole("button", { name: "Create project" }).dblclick();
    await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/);
    await page.goto("/dashboard");
    await expect(page.getByText(name)).toHaveCount(1);
  });

  test("security: pages carry a nonce CSP and no inline-script allowance", async ({ request }) => {
    const res = await request.get("/dashboard");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).not.toContain("'unsafe-inline' 'self'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
