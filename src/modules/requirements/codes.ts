import type { Requirement } from "./schema";

/** Next display code: FR-03 / NFR-02, continuing after the highest existing number for that prefix. */
export function nextCode(existing: { code: string }[], type: Requirement["type"]): string {
  const prefix = type === "functional" ? "FR" : "NFR";
  const max = existing
    .map((r) => /^(N?FR)-(\d+)$/.exec(r.code))
    .filter((m): m is RegExpExecArray => m?.[1] === prefix)
    .reduce((n, m) => Math.max(n, Number(m[2])), 0);
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/**
 * The current version of each requirement (ADR-006): the highest version per code, in the order the
 * codes first appeared. After a withdrawal (PF-053) the current version is REJECTED.
 */
export function currentRequirements(rows: Requirement[]): Requirement[] {
  const latest = new Map<string, Requirement>();
  for (const r of rows) {
    const seen = latest.get(r.code);
    if (!seen || r.version > seen.version) latest.set(r.code, r);
  }
  return [...latest.values()];
}
