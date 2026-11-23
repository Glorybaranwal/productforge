// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { apiKeyStatus } from "@/components/settings/api-key-status";
import type { ApiKey } from "@/src/modules/api-keys/schema";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const future = new Date(Date.now() + 30 * 864e5).toISOString();
const past = new Date(Date.now() - 864e5).toISOString();

const key = (over: Partial<ApiKey>): ApiKey => ({
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  userId: ME,
  name: "Jira sync",
  prefix: "abcdefgh",
  scope: "read",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: null,
  expiresAt: future,
  revokedAt: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("apiKeyStatus", () => {
  it("lets revoked win over expired", () => {
    expect(apiKeyStatus({ revokedAt: past, expiresAt: past })).toBe("revoked");
    expect(apiKeyStatus({ revokedAt: null, expiresAt: past })).toBe("expired");
    expect(apiKeyStatus({ revokedAt: null, expiresAt: future })).toBe("active");
  });
});

describe("ApiKeysPanel", () => {
  it("explains that a key acts as its creator when there are none", () => {
    render(<ApiKeysPanel initialKeys={[]} currentUserId={ME} seesWorkspaceKeys={false} />);
    expect(screen.getByText(/acts as you/i)).toBeTruthy();
  });

  it("labels another member's key and marks revoked and expired keys", () => {
    render(
      <ApiKeysPanel
        initialKeys={[
          key({ id: "a", name: "Mine" }),
          key({ id: "b", name: "Theirs", userId: OTHER }),
          key({ id: "c", name: "Old", revokedAt: past }),
          key({ id: "d", name: "Lapsed", expiresAt: past }),
        ]}
        currentUserId={ME}
        seesWorkspaceKeys
      />,
    );
    expect(screen.getByText(/Another member's key — Member 22222222/)).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getAllByText(/Never used/).length).toBe(4);
  });

  it("shows the plaintext once and not again after a refetch or dismissal", async () => {
    const created = key({ name: "CI" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ key: created, plaintext: "pf_test_abcdefgh_SECRET" }, { status: 201 })
        : Response.json({ keys: [created] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ApiKeysPanel initialKeys={[]} currentUserId={ME} seesWorkspaceKeys={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect((await screen.findByTestId("api-key-plaintext")).textContent).toBe(
      "pf_test_abcdefgh_SECRET",
    );
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("CI", { selector: "span" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /saved it/i }));
    expect(screen.queryByText(/SECRET/)).toBeNull();
  });

  it("asks before revoking and says it stops working at once", async () => {
    const fetchMock = vi.fn(async () => Response.json({ keys: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ApiKeysPanel initialKeys={[key({})]} currentUserId={ME} seesWorkspaceKeys={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByText(/immediately/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspace/api-keys/33333333-3333-4333-8333-333333333333",
        { method: "DELETE" },
      ),
    );
  });
});
