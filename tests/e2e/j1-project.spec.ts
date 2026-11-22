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

    // A second create request may still be in flight: read the API until the count stops changing.
    const countNamed = async () => {
      const res = await page.request.get("/api/projects");
      const { projects } = (await res.json()) as { projects: { name: string }[] };
      return projects.filter((p) => p.name === name).length;
    };
    let count = await countNamed();
    for (let stable = 0; stable < 4;) {
      await page.waitForTimeout(500);
      const next = await countNamed();
      stable = next === count ? stable + 1 : 0;
      count = next;
    }
    expect(count).toBe(1);

    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(1);
  });

  test("security: pages carry a nonce CSP and no inline-script allowance", async ({ request }) => {
    const res = await request.get("/dashboard");
    const csp = res.headers()["content-security-policy"] ?? "";
    // The webServer runs `next dev`, where ADR-032 also allows 'unsafe-eval' for React's dev tooling,
    // so only 'unsafe-inline' is asserted here. The production policy (no 'unsafe-eval' either) is
    // covered by tests/unit/lib/csp.test.ts.
    const directive = csp.split(";").map((d) => d.trim().split(/\s+/));
    const scriptSrc = directive.find(([name]) => name === "script-src") ?? [];
    expect(scriptSrc.length).toBeGreaterThan(1);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc.some((v) => v.startsWith("'nonce-"))).toBe(true);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
