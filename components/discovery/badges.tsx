import { cn } from "@/src/lib/utils";
import {
  EVIDENCE_LABELS,
  type Evidence,
  type Requirement,
} from "@/src/modules/requirements/schema";

const EVIDENCE_STYLE: Record<Evidence, string> = {
  EXPLICIT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  INFERRED: "border-sky-200 bg-sky-50 text-sky-800",
  ASSUMPTION: "border-amber-200 bg-amber-50 text-amber-900",
  OPEN_QUESTION: "border-violet-200 bg-violet-50 text-violet-800",
};

const EVIDENCE_HELP: Record<Evidence, string> = {
  EXPLICIT: "Stated in a source or answer — quoted below",
  INFERRED: "Strongly implied but not stated",
  ASSUMPTION: "A default the team must confirm",
  OPEN_QUESTION: "Undecided in the source",
};

const pill =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  return (
    <span className={cn(pill, EVIDENCE_STYLE[evidence])} title={EVIDENCE_HELP[evidence]}>
      {EVIDENCE_LABELS[evidence]}
    </span>
  );
}

export function TypeBadge({ type }: { type: Requirement["type"] }) {
  return (
    <span className={cn(pill, "border-border bg-background text-muted-foreground")}>
      {type === "functional" ? "Functional" : "Non-functional"}
    </span>
  );
}

export function StatusBadge({ status }: { status: Requirement["status"] }) {
  const style =
    status === "APPROVED"
      ? "border-transparent bg-primary text-primary-foreground"
      : status === "REJECTED"
        ? "border-border bg-muted text-muted-foreground line-through"
        : "border-border bg-secondary text-secondary-foreground";
  const label = status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Draft";
  return <span className={cn(pill, style)}>{label}</span>;
}
