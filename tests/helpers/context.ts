import type { Role, Session } from "@/src/lib/auth";
import { setDataStore } from "@/src/db/store";
import { createMemoryStore } from "@/src/db/drivers/memory";
import { ensureWorkspace } from "@/src/modules/workspaces/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

/** Fresh, empty in-memory database. Call in beforeEach. */
export function resetDb(): void {
  setDataStore(createMemoryStore());
}

let counter = 0;

/** A user with their own workspace; `role` overrides their membership role for permission tests. */
export async function makeContext(role?: Role, name = "Test User"): Promise<WorkspaceContext> {
  counter += 1;
  const session: Session = {
    userId: `user-${counter}`,
    name,
    email: `user${counter}@example.com`,
  };
  const ctx = await ensureWorkspace(session);
  return role ? { ...ctx, role } : ctx;
}

export const validProject = {
  name: "Transaction dashboard",
  domain: "Fintech",
  audience: "Retail banking customers",
  teamSize: 5,
  sprintLengthDays: 14,
};
