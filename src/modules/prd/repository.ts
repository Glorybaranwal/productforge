import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgPrds } from "./pg-repository";
import type { Prd } from "./schema";
import { storePrds } from "./store-repository";

/** PRD versions are append-only once approved (ADR-006): approved rows are never updated. */
export interface PrdRepository {
  /** Every version, oldest first. */
  listByProject(scope: WorkspaceScope, projectId: string): Promise<Prd[]>;
  findById(scope: WorkspaceScope, id: string): Promise<Prd | null>;
  /** Inserts the project's next version. CONFLICT while another draft is open (ADR-028). */
  insertVersion(scope: WorkspaceScope, prd: Omit<Prd, "version">): Promise<Prd>;
  /** Updates a DRAFT only; returns null if it's missing or already approved. */
  updateDraft(scope: WorkspaceScope, id: string, patch: Partial<Prd>): Promise<Prd | null>;
}

const postgres = () => dataBackend() === "postgres";

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-028). */
export const prdRepository: PrdRepository = {
  listByProject: (...a) => (postgres() ? pgPrds : storePrds).listByProject(...a),
  findById: (...a) => (postgres() ? pgPrds : storePrds).findById(...a),
  insertVersion: (...a) => (postgres() ? pgPrds : storePrds).insertVersion(...a),
  updateDraft: (...a) => (postgres() ? pgPrds : storePrds).updateDraft(...a),
};
