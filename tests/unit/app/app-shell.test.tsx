// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";

const shell = (authMode: "demo" | "supabase", dataBackend: "store" | "postgres") =>
  render(
    <AppShell workspaceName="Acme" userName="Ana" authMode={authMode} dataBackend={dataBackend}>
      <p>content</p>
    </AppShell>,
  );

describe("AppShell data badge", () => {
  it("says demo mode without sign-in", () => {
    shell("demo", "store");
    expect(screen.getByText("Demo mode")).toBeInTheDocument();
  });

  it("says local data when signed in but stored on this computer", () => {
    shell("supabase", "store");
    expect(screen.getByText("Local data")).toBeInTheDocument();
  });

  it("says Supabase data when the database holds the data", () => {
    shell("supabase", "postgres");
    expect(screen.getByText("Supabase data")).toBeInTheDocument();
    expect(screen.queryByText("Local data")).not.toBeInTheDocument();
  });
});
