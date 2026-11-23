import type { Metadata } from "next";

import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { listApiKeys } from "@/src/modules/api-keys/service";
import { currentContext } from "@/src/modules/workspaces/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const ctx = await currentContext();
  return (
    <ApiKeysPanel
      initialKeys={await listApiKeys(ctx)}
      currentUserId={ctx.session.userId}
      seesWorkspaceKeys={ctx.role === "owner" || ctx.role === "admin"}
    />
  );
}
