// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequirementHistoryPanel } from "@/components/discovery/requirement-history";

const version = (n: number, text: string, change: { code: string; reason: string } | null) => ({
  version: n,
  text,
  type: "functional",
  evidence: "EXPLICIT",
  status: "APPROVED",
  rationale: null,
  createdAt: "2026-11-22T10:00:00.000Z",
  change: change && { ...change, status: "APPROVED" },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RequirementHistoryPanel", () => {
  it("shows removed and added words and links the change request", async () => {
    const history = [
      {
        code: "FR-07",
        versions: [
          version(1, "Reports download as CSV files", null),
          version(2, "Reports download as PDF files", { code: "CR-01", reason: "Finance asked" }),
        ],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ history })),
    );
    render(<RequirementHistoryPanel projectId="p1" code="FR-07" id="h" />);
    expect((await screen.findByText("CSV")).tagName).toBe("DEL");
    expect(screen.getByText("PDF").tagName).toBe("INS");
    expect(screen.getByRole("link", { name: "CR-01" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p1/changes#CR-01",
    );
  });

  it("says so when the newer version has no change request", async () => {
    const history = [
      {
        code: "FR-07",
        versions: [version(1, "Reports as CSV", null), version(2, "Reports as PDF", null)],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ history })),
    );
    render(<RequirementHistoryPanel projectId="p1" code="FR-07" id="h" />);
    expect(await screen.findByText("Edited without a change request.")).toBeTruthy();
  });

  it("explains a failed load and retries", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RequirementHistoryPanel projectId="p1" code="FR-07" id="h" />);
    expect(await screen.findByText("Couldn't load the history. Try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
