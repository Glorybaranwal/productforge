// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("shows the product name as the main heading", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "ProductForge AI" })).toBeInTheDocument();
  });

  it("lists the pipeline from idea to tasks in order", () => {
    render(<HomePage />);

    const steps = within(screen.getByRole("list", { name: "Pipeline" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent?.replace("→", "").trim());

    expect(steps).toEqual(["Idea", "PRD", "Epics", "Stories", "Acceptance criteria", "Tasks"]);
  });

  it("links to the dashboard", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
