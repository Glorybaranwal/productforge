import { dataBackend, type Scope } from "@/src/db/scope";

import { pgProjects } from "./pg-repository";
import type { Project, ProjectInput } from "./schema";
import { storeProjects } from "./store-repository";

export interface ProjectRepository {
  /** Most recently updated first. */
  listByWorkspace(scope: Scope, workspaceId: string): Promise<Project[]>;
  findById(scope: Scope, workspaceId: string, id: string): Promise<Project | null>;
  insert(scope: Scope, project: Project): Promise<Project>;
  update(
    scope: Scope,
    workspaceId: string,
    id: string,
    patch: Partial<ProjectInput>,
    updatedAt: string,
  ): Promise<Project | null>;
  remove(scope: Scope, workspaceId: string, id: string): Promise<boolean>;
}

const pick = (): ProjectRepository => (dataBackend() === "postgres" ? pgProjects : storeProjects);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022). */
export const projectRepository: ProjectRepository = {
  listByWorkspace: (...args) => pick().listByWorkspace(...args),
  findById: (...args) => pick().findById(...args),
  insert: (...args) => pick().insert(...args),
  update: (...args) => pick().update(...args),
  remove: (...args) => pick().remove(...args),
};
