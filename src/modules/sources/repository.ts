import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgSources } from "./pg-repository";
import type { SourceDocument } from "./schema";
import { storeSources } from "./store-repository";

export interface SourceRepository {
  listByProject(scope: WorkspaceScope, projectId: string): Promise<SourceDocument[]>;
  insert(scope: WorkspaceScope, source: SourceDocument): Promise<SourceDocument>;
  remove(scope: WorkspaceScope, projectId: string, id: string): Promise<boolean>;
}

const pick = (): SourceRepository => (dataBackend() === "postgres" ? pgSources : storeSources);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-026). */
export const sourceRepository: SourceRepository = {
  listByProject: (...a) => pick().listByProject(...a),
  insert: (...a) => pick().insert(...a),
  remove: (...a) => pick().remove(...a),
};
