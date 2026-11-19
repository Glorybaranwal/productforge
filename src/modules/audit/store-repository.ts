import { readState, transact } from "@/src/db/store";

import type { AuditRepository } from "./repository";

/** Demo store (ADR-011). */
export const storeAudit: AuditRepository = {
  async insert(_scope, entry) {
    return transact((state) => {
      state.auditLogs.push(entry);
      return entry;
    });
  },

  // The log is append-only, so reversed insertion order is newest first.
  async listForEntity(_scope, workspaceId, entityType, entityId) {
    const state = await readState();
    return state.auditLogs
      .filter(
        (e) =>
          e.workspaceId === workspaceId && e.entityType === entityType && e.entityId === entityId,
      )
      .reverse();
  },
};
