export type AuditExec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export function auditDataIsolation(
  exec: AuditExec,
): Promise<{ failures: string[]; notes: string[] }>;
