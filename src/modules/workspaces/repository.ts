import { dataBackend, type Scope } from "@/src/db/scope";

import { pgWorkspaces } from "./pg-repository";
import type { Workspace, WorkspaceMember } from "./schema";
import { storeWorkspaces } from "./store-repository";

export type DefaultWorkspace = { workspace: Workspace; member: WorkspaceMember; created: boolean };

export interface WorkspaceRepository {
  findById(scope: Scope, id: string): Promise<Workspace | null>;
  membershipsForUser(scope: Scope, userId: string): Promise<WorkspaceMember[]>;
  /** The user's first workspace, created (with the user as owner) if they have none. */
  ensureDefault(
    scope: Scope,
    userId: string,
    make: () => { workspace: Workspace; member: WorkspaceMember },
  ): Promise<DefaultWorkspace>;
}

const pick = (): WorkspaceRepository =>
  dataBackend() === "postgres" ? pgWorkspaces : storeWorkspaces;

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022). */
export const workspaceRepository: WorkspaceRepository = {
  findById: (...args) => pick().findById(...args),
  membershipsForUser: (...args) => pick().membershipsForUser(...args),
  ensureDefault: (...args) => pick().ensureDefault(...args),
};
