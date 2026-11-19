/** Activity-feed wording for sprint planning audit entries (PF-051, PF-052). */
import type { AuditLog } from "@/src/modules/audit/schema";

const to = (entry: AuditLog, key: string) =>
  (entry.diff?.[key] as { to?: unknown } | undefined)?.to;
const from = (entry: AuditLog, key: string) =>
  (entry.diff?.[key] as { from?: unknown } | undefined)?.from;

export function describeSprintActivity(entry: AuditLog): string | null {
  switch (entry.action) {
    case "sprints.planned": {
      const kept = Number(to(entry, "keptByHand") ?? 0);
      return `planned ${String(to(entry, "stories"))} stories into ${String(to(entry, "sprints"))} sprints${kept ? ` (kept ${kept} placed by hand)` : ""}`;
    }
    case "sprints.settings_updated":
      return `set velocity to ${String(to(entry, "velocity"))} points, sprint 1 starting ${String(to(entry, "startDate"))}`;
    case "sprint.story_moved": {
      const target = to(entry, "sprint");
      const story = String(to(entry, "story"));
      return target === null
        ? `took ${story} out of the sprint plan`
        : `moved ${story} to sprint ${String(target)}`;
    }
    case "sprint.updated": {
      const parts: string[] = [];
      if (entry.diff?.goal)
        parts.push(
          to(entry, "goal")
            ? `goal “${String(to(entry, "goal"))}”`
            : "goal back to the suggested one",
        );
      if (entry.diff?.capacity)
        parts.push(
          `capacity ${String(from(entry, "capacity"))} → ${String(to(entry, "capacity"))} points`,
        );
      return `updated sprint ${String(to(entry, "sprint"))}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    }
    default:
      return null;
  }
}
