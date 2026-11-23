import { z } from "zod";

import type { Tx } from "@/src/db/client";
import { ROLES, type Role, type Session } from "@/src/lib/auth";

export const Workspace = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  ownerId: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Workspace = z.infer<typeof Workspace>;

export const WorkspaceMember = z.object({
  workspaceId: z.uuid(),
  userId: z.string().min(1),
  role: z.enum(ROLES),
  createdAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMember>;

/**
 * Who is acting and in which workspace. Every service call takes one; every query is scoped by it.
 * `tx` is set inside a unit of work (PF-015): repository calls then share its transaction.
 * `viaApiKey` is set only by `contextForApiKey` (PF-083): the request authenticated with an API key
 * and not a person's sign-in, so approve and confirm services refuse it (CLAUDE.md §7.7, ADR-036).
 * Nothing else may set it, and it survives `{ ...ctx, tx }`, so a unit of work keeps it.
 */
export type WorkspaceContext = {
  session: Session;
  workspace: Workspace;
  role: Role;
  tx?: Tx;
  viaApiKey?: true;
};
