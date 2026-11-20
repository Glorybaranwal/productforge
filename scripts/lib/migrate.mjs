// Helpers for `pnpm db:migrate` (scripts/db-migrate.mjs), kept apart so they can be unit-tested.

/** Tags of the journal's migrations newer than the last one the database recorded. */
export function pendingMigrations(journal, lastCreatedAt) {
  return journal.entries.filter((entry) => entry.when > lastCreatedAt).map((entry) => entry.tag);
}

const FIELDS = ["code", "detail", "hint", "where", "table_name", "constraint_name", "routine"];

/**
 * A readable account of a failed migration: the database's own message and fields, and the first
 * line of the statement that failed. Credentials in connection strings are masked.
 */
export function describeDbError(err) {
  const root = err?.cause ?? err;
  const lines = [`  ${root?.message || root?.code || String(root)}`];
  for (const field of FIELDS) if (root?.[field]) lines.push(`  ${field}: ${root[field]}`);
  if (typeof err?.query === "string") lines.push(`  statement: ${firstLine(err.query)}`);
  return lines.join("\n").replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1***@");
}

function firstLine(query) {
  const line = query.trim().split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
