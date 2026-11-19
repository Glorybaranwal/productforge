/** Activity-feed wording for change requests (PF-053). */
import type { AuditLog } from "@/src/modules/audit/schema";

const to = (entry: AuditLog, key: string) =>
  (entry.diff?.[key] as { to?: unknown } | undefined)?.to;

const VERB: Record<string, string> = {
  modify: "a change to",
  add: "a new requirement",
  withdraw: "withdrawing",
};

export function describeChangeActivity(entry: AuditLog): string | null {
  if (!entry.action.startsWith("change.")) return null;
  const cr = String(to(entry, "change") ?? "a change");
  const req = String(to(entry, "requirement") ?? "");
  const kind = String(to(entry, "kind") ?? "modify");
  const subject = kind === "add" ? VERB.add : `${VERB[kind] ?? "a change to"} ${req}`;
  switch (entry.action) {
    case "change.proposed":
      return `proposed ${cr}: ${subject}`;
    case "change.approved": {
      const flagged = Number(to(entry, "flagged") ?? 0);
      const what =
        kind === "add"
          ? `added ${req}`
          : kind === "withdraw"
            ? `withdrew ${req}`
            : `changed ${req} to version ${String(to(entry, "version"))}`;
      return `approved ${cr} (${what})${flagged ? ` — ${flagged} ${flagged === 1 ? "item needs" : "items need"} review` : ""}`;
    }
    case "change.discarded":
      return `discarded ${cr}`;
    case "change.reviewed": {
      const note = to(entry, "note");
      return `reviewed ${String(to(entry, "item"))} for ${cr}, no change needed${note ? ` (“${String(note)}”)` : ""}`;
    }
    default:
      return null;
  }
}
