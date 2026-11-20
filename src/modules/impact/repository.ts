import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgChanges } from "./pg-repository";
import type { ImpactReview, RequirementChange } from "./schema";
import { storeChanges } from "./store-repository";

export type ChangeRows = { changes: RequirementChange[]; reviews: ImpactReview[] };

/** Change requests and review marks (PF-053, PF-074). Decided changes never change. */
export interface ImpactRepository {
  load(scope: WorkspaceScope, projectId: string): Promise<ChangeRows>;
  find(scope: WorkspaceScope, id: string): Promise<RequirementChange | null>;
  /** Inserts with the next CR number for the project. */
  insert(scope: WorkspaceScope, row: Omit<RequirementChange, "number">): Promise<RequirementChange>;
  /** Updates a proposed change (DRAFT only); null for decided or unknown ones. */
  update(
    scope: WorkspaceScope,
    id: string,
    patch: Partial<RequirementChange>,
  ): Promise<RequirementChange | null>;
  /** Records a review mark once; a repeat is ignored. */
  addReview(scope: WorkspaceScope, review: ImpactReview): Promise<void>;
}

const pick = () => (dataBackend() === "postgres" ? pgChanges : storeChanges);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-030). */
export const impactRepository: ImpactRepository = {
  load: (...a) => pick().load(...a),
  find: (...a) => pick().find(...a),
  insert: (...a) => pick().insert(...a),
  update: (...a) => pick().update(...a),
  addReview: (...a) => pick().addReview(...a),
};
