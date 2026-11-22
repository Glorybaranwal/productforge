import { expect, type Page } from "@playwright/test";

export const BRIEF =
  "Customers can view transactions, filter them, download reports, and receive notifications for failed transactions. " +
  "It must be really fast.\nOpen: not sure yet whether business accounts are in scope.";

/** J1: creates a project through the form and returns its page URL. */
export async function createProject(page: Page, name = `E2E ${Date.now()}`): Promise<string> {
  await page.goto("/dashboard/projects/new");
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Domain").fill("Fintech");
  await page.getByLabel("Audience").fill("Retail banking customers");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}
