import Link from "next/link";

import { StoryStatusBadge } from "@/components/backlog/editor-section";
import { cn } from "@/src/lib/utils";
import {
  TRACE_STATUS_LABELS,
  TRACE_STEP_LABELS,
  TRACE_STEPS,
  type StoryRef,
  type TraceStatus,
  type TraceStep,
} from "@/src/modules/traceability/schema";

const pill =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

const STATUS_STYLE: Record<TraceStatus, string> = {
  traced: "border-transparent bg-primary text-primary-foreground",
  in_review: "border-sky-200 bg-sky-50 text-sky-800",
  incomplete: "border-amber-200 bg-amber-50 text-amber-900",
  rejected_only: "border-rose-200 bg-rose-50 text-rose-800",
  gap: "border-rose-200 bg-rose-50 text-rose-800",
  waiting: "border-violet-200 bg-violet-50 text-violet-800",
};

export function TraceStatusBadge({ status }: { status: TraceStatus }) {
  return <span className={cn(pill, STATUS_STYLE[status])}>{TRACE_STATUS_LABELS[status]}</span>;
}

/** Five dots: PRD → story → criteria → tasks → approved. Read out as text for screen readers. */
export function TraceChain({ steps, label }: { steps: Record<TraceStep, boolean>; label: string }) {
  const done = TRACE_STEPS.filter((s) => steps[s]);
  const missing = TRACE_STEPS.filter((s) => !steps[s]);
  const text = `${label}: ${done.length} of ${TRACE_STEPS.length} links${
    missing.length
      ? `; missing: ${missing.map((s) => TRACE_STEP_LABELS[s].toLowerCase()).join(", ")}`
      : ""
  }`;
  return (
    <span role="img" aria-label={text} title={text} className="inline-flex items-center gap-1">
      {TRACE_STEPS.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          {i > 0 && <span className={cn("h-px w-2", steps[s] ? "bg-primary" : "bg-border")} />}
          <span
            className={cn(
              "size-2.5 rounded-full border",
              steps[s] ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background",
            )}
          />
        </span>
      ))}
    </span>
  );
}

/** A story code that opens the story on the backlog page. */
export function StoryLink({ story, backlogHref }: { story: StoryRef; backlogHref: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Link
        href={`${backlogHref}?story=${story.code}`}
        className="font-mono text-xs font-medium whitespace-nowrap underline-offset-4 hover:underline"
        title={story.title}
      >
        {story.code}
      </Link>
      <StoryStatusBadge status={story.status} />
    </span>
  );
}

export function CriteriaCounts({ stories }: { stories: StoryRef[] }) {
  if (!stories.length) return <span className="text-muted-foreground">–</span>;
  const sum = (k: keyof StoryRef["criteria"]) => stories.reduce((n, s) => n + s.criteria[k], 0);
  return (
    <span className="whitespace-nowrap" title="Positive / negative / edge-case criteria">
      {sum("positive")} / {sum("negative")} / {sum("edge")}
    </span>
  );
}
