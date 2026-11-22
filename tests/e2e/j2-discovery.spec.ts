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
    await expect(page.getByTestId("latest-run")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "Requirements" })).toBeVisible();
    await expect(page.getByText(/Confirm requirements/).first()).toBeVisible();

    // The run log, through the API: exactly one run, and one audit entry for it.
    const projectId = projectUrl.split("/").pop();
    const res = await page.request.get(`/api/projects/${projectId}/discovery`);
    expect(res.ok()).toBeTruthy();
    const state = (await res.json()) as {
      discovery: { runCount: number; agentRunId: string } | null;
      latestRun: { id: string } | null;
    };
    expect(state.discovery?.runCount).toBe(1);
    expect(state.latestRun?.id).toBe(state.discovery?.agentRunId);
    const activity = await page.request.get(`/api/projects/${projectId}/activity`);
    const { activity: entries } = (await activity.json()) as { activity: { action: string }[] };
    expect(entries.filter((e) => e.action === "discovery.run")).toHaveLength(1);
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
