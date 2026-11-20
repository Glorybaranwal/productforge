export function pendingMigrations(
  journal: { entries: { tag: string; when: number }[] },
  lastCreatedAt: number,
): string[];
export function describeDbError(err: unknown): string;
