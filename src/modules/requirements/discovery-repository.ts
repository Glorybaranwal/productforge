import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgDiscovery } from "./pg-discovery-repository";
import type { Discovery, DiscoveryOutput } from "./schema";
import { storeDiscovery } from "./store-repository";

export interface DiscoveryRepository {
  get(scope: WorkspaceScope, projectId: string): Promise<Discovery | null>;
  /**
   * Saves a successful discovery run in one transaction:
   * - untouched AI drafts from earlier runs are replaced by the new ones;
   * - the user's work is kept: approved, rejected, human-added and edited requirements, and every
   *   resolved question (new items that duplicate them are skipped);
   * - open questions from earlier runs are replaced by the new open questions.
   */
  applyRun(
    scope: WorkspaceScope,
    projectId: string,
    output: DiscoveryOutput,
    agentRunId: string,
  ): Promise<Discovery>;
  /** Gate 1. `by` is the confirming user's name, kept as a snapshot. */
  confirm(
    scope: WorkspaceScope,
    projectId: string,
    by: string,
    at: string,
  ): Promise<Discovery | null>;
}

const pick = (): DiscoveryRepository =>
  dataBackend() === "postgres" ? pgDiscovery : storeDiscovery;

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-026). */
export const discoveryRepository: DiscoveryRepository = {
  get: (...a) => pick().get(...a),
  applyRun: (...a) => pick().applyRun(...a),
  confirm: (...a) => pick().confirm(...a),
};
