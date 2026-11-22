import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
// eslint-disable-next-line no-restricted-imports -- reads the DATA_DRIVER setting only, no data
import { dataBackend } from "@/src/db/scope";
import { AppError } from "@/src/lib/errors";
import { authDriver } from "@/src/lib/supabase/config";
import { currentContext } from "@/src/modules/workspaces/service";

// Reads live data on every request (demo store or database), never at build time.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // proxy.ts already sends signed-out visitors to /login; this covers a session that ends mid-request.
  const ctx = await currentContext().catch((err: unknown) => {
    if (err instanceof AppError && err.code === "UNAUTHORIZED") return null;
    throw err;
  });
  if (!ctx) redirect("/login");
  return (
    <AppShell
      workspaceName={ctx.workspace.name}
      userName={ctx.session.name}
      authMode={authDriver()}
      dataBackend={dataBackend()}
    >
      {children}
    </AppShell>
  );
}
