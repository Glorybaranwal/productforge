import Link from "next/link";

import { cn } from "@/src/lib/utils";
import type { Gap } from "@/src/modules/traceability/schema";

const SEVERITY = {
  blocker: { label: "Fix first", style: "border-rose-200 bg-rose-50" },
  warning: { label: "To do", style: "border-amber-200 bg-amber-50" },
  info: { label: "FYI", style: "border-border bg-muted/40" },
} as const;

/** What to fix, most serious first, each with a link to where it gets fixed. */
export function GapList({ gaps }: { gaps: Gap[] }) {
  return (
    <section aria-label="Gaps" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Gaps</h2>
      {gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No gaps — every requirement is traced to an approved story.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {gaps.map((g, i) => (
            <li
              key={`${g.kind}-${i}`}
              className={cn(
                "space-y-1.5 rounded-lg border p-3 text-sm",
                SEVERITY[g.severity].style,
              )}
            >
              <p>
                <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SEVERITY[g.severity].label}
                </span>
                {g.message}
              </p>
              {g.action && (
                <Link
                  href={g.action.href}
                  className="text-xs font-medium underline underline-offset-4"
                >
                  {g.action.label} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
