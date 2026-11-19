import { dataBackend, type Scope } from "@/src/db/scope";

import { pgAudit } from "./pg-repository";
import type { AuditLog } from "./schema";
import { storeAudit } from "./store-repository";

export interface AuditRepository {
  insert(scope: Scope, entry: AuditLog): Promise<AuditLog>;
  /** Newest first, scoped by workspace. */
  listForEntity(
    scope: Scope,
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditLog[]>;
}

const pick = (): AuditRepository => (dataBackend() === "postgres" ? pgAudit : storeAudit);

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022). */
export const auditRepository: AuditRepository = {
  insert: (...args) => pick().insert(...args),
  listForEntity: (...args) => pick().listForEntity(...args),
};
