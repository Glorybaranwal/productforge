import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AppShellProps = {
  workspaceName: string;
  userName: string;
  /** "demo": no sign-in (ADR-011); "supabase": signed in, with a sign-out button (PF-013). */
  authMode: "demo" | "supabase";
  /** Where data lives: the file store on this computer, or Supabase Postgres (ADR-022). */
  dataBackend: "store" | "postgres";
  children: ReactNode;
};

/** Signed-in chrome: product name, workspace, data-mode marker, user, sign-out. */
export function AppShell({
  workspaceName,
  userName,
  authMode,
  dataBackend,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            ProductForge AI
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="truncate text-sm text-muted-foreground" data-testid="workspace-name">
            {workspaceName}
          </span>
          <nav aria-label="Main" className="ml-2 flex items-center gap-1 text-sm">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Projects</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/settings/api-keys">API keys</Link>
            </Button>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {authMode === "demo" ? (
              <Badge
                variant="outline"
                title="No sign-in or external services; data is stored locally (ADR-011)"
              >
                Demo mode
              </Badge>
            ) : dataBackend === "postgres" ? (
              <Badge
                variant="outline"
                title="Signed in with Supabase; data is stored in the Supabase database, module by module (PF-070–PF-075)"
              >
                Supabase data
              </Badge>
            ) : (
              <Badge
                variant="outline"
                title="Signed in with Supabase; data is stored on this computer (DATA_DRIVER isn't postgres)"
              >
                Local data
              </Badge>
            )}
            <span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span>
            {authMode === "supabase" && (
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
