import { expect, test } from "@playwright/test";

import { BRIEF, createProject } from "./helpers";

test.describe("J2 · discovery to Gate 1", () => {
  test("pasted brief → run discovery → evidence-labelled requirements and questions", async ({
    page,
  }) => {
    const projectUrl = await createProject(page);
    await page.goto(`${projectUrl}/discovery`);

    const run = page.getByRole("button", { name: "Run discovery" });
    await expect(run).toBeDisabled(); // dumb user: nothing to run on yet

    await page.getByLabel("Paste notes").fill(BRIEF);
    await page.getByRole("button", { name: "Add notes" }).click();
    await expect(page.getByRole("list", { name: "Sources" })).toBeVisible();

    await run.dblclick(); // dumb user: one run, not two
    await expect(page.getByText(/EXPLICIT|INFERRED/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Confirm requirements/)).toBeVisible();

    const runs = await page.request.get(`/api/projects/${projectUrl.split("/").pop()}/discovery`);
    expect(runs.ok()).toBeTruthy();
  });

  test("dumb user: notes that are too short are refused with a message", async ({ page }) => {
    const projectUrl = await createProject(page);
    await page.goto(`${projectUrl}/discovery`);
    await page.getByLabel("Paste notes").fill("hi");
    await page.getByRole("button", { name: "Add notes" }).click();
    await expect(page.getByText("Add at least a sentence of text")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sources" })).toHaveCount(0);
  });
});
