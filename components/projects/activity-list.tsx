import { formatDateTime } from "@/src/lib/format";
import type { AuditLog } from "@/src/modules/audit/schema";
import { describeExport } from "@/src/modules/exports/describe";
import { describeChangeActivity } from "@/src/modules/impact/describe";
import { formatSprintLength } from "@/src/modules/projects/schema";
import { describeSprintActivity } from "@/src/modules/sprints/describe";

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  domain: "domain",
  audience: "audience",
  teamSize: "team size",
  sprintLengthDays: "sprint length",
};

function formatValue(field: string, value: unknown): string {
  if (field === "sprintLengthDays" && typeof value === "number") return formatSprintLength(value);
  return String(value);
}

const story = (entry: AuditLog) => String((entry.diff?.story as { to?: unknown })?.to ?? "a story");

/** Plain-language summary of one audit entry, e.g. "updated team size (5 → 8)". */
export function describeActivity(entry: AuditLog): string {
  if (entry.action.endsWith(".exported")) {
    const e = describeExport(entry);
    return `exported ${e.what}${e.detail ? ` (${e.detail})` : ""}`;
  }
  const sprint = describeSprintActivity(entry) ?? describeChangeActivity(entry);
  if (sprint) return sprint;
  switch (entry.action) {
    case "project.created":
      return "created the project";
    case "project.deleted":
      return "deleted the project";
    case "project.updated": {
      const changes = Object.entries(entry.diff ?? {}).map(([field, change]) => {
        const { from, to } = change as { from: unknown; to: unknown };
        const label = FIELD_LABELS[field] ?? field;
        return `${label} (${formatValue(field, from)} → ${formatValue(field, to)})`;
      });
      return changes.length ? `updated ${changes.join(", ")}` : "updated the project";
    }
    case "source.added":
      return `added source “${String((entry.diff?.source as { to?: unknown })?.to ?? "")}”`;
    case "source.removed":
      return `removed source “${String((entry.diff?.source as { from?: unknown })?.from ?? "")}”`;
    case "discovery.run":
      return "ran discovery";
    case "discovery.failed":
      return "ran discovery (failed)";
    case "requirements.confirmed": {
      const count = (entry.diff?.approved as { to?: unknown })?.to;
      return `confirmed ${String(count ?? "")} requirements (Gate 1)`;
    }
    case "prd.generated":
      return "generated the PRD";
    case "prd.failed":
      return "generated the PRD (failed)";
    case "prd.updated": {
      const section = String((entry.diff?.section as { to?: unknown })?.to ?? "");
      const version = String((entry.diff?.version as { to?: unknown })?.to ?? "");
      return `edited the PRD (${section.replace(/([A-Z])/g, " $1").toLowerCase()}, v${version})`;
    }
    case "prd.approved":
      return `approved PRD version ${String((entry.diff?.version as { to?: unknown })?.to ?? "")} (Gate 2)`;
    case "prd.version_created":
      return `started PRD version ${String((entry.diff?.version as { to?: unknown })?.to ?? "")}`;
    case "backlog.generated":
      return `generated the backlog (${String((entry.diff?.runs as { to?: unknown })?.to ?? "")})`;
    case "backlog.failed":
      return "generated the backlog (failed)";
    case "backlog.bulk_approved":
      return `approved ${String((entry.diff?.stories as { to?: unknown })?.to ?? "")} (Gate 3)`;
    case "story.created":
      return `added ${story(entry)} by hand`;
    case "story.updated":
      return `edited ${story(entry)} (${String((entry.diff?.section as { to?: unknown })?.to ?? "")})`;
    case "story.approved":
      return `approved ${story(entry)} v${String((entry.diff?.version as { to?: unknown })?.to ?? "")} (Gate 3)`;
    case "story.rejected":
      return `rejected ${story(entry)}: “${String((entry.diff?.reason as { to?: unknown })?.to ?? "")}”`;
    case "story.restored":
      return `restored ${story(entry)} to draft`;
    case "story.regenerated": {
      const note = (entry.diff?.note as { to?: unknown })?.to;
      return `regenerated ${story(entry)}${note ? ` with note “${String(note)}”` : ""}`;
    }
    case "story.regenerate_failed":
      return `regenerated ${story(entry)} (failed)`;
    case "story.version_created":
      return `started ${story(entry)} version ${String((entry.diff?.version as { to?: unknown })?.to ?? "")}`;
    default:
      return entry.action.replace(/[._]/g, " ");
  }
}

export function ActivityList({ entries }: { entries: AuditLog[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol aria-label="Activity" className="space-y-4">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-0.5 text-sm">
          <p>
            <span className="font-medium">{entry.actorName}</span> {describeActivity(entry)}
          </p>
          <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}
