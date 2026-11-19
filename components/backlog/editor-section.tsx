"use client";

import type { ReactNode } from "react";

import { cn } from "@/src/lib/utils";
import {
  CRITERION_KIND_LABELS,
  PRIORITY_LABELS,
  type CriterionKind,
  type Priority,
  type Story,
} from "@/src/modules/stories/schema";

import { saveStatusText, type SaveStatus } from "./use-autosave";

/** A titled block inside a story card, with its autosave status and error. */
export function EditorSection({
  title,
  status,
  message,
  children,
  hint,
}: {
  title: string;
  status?: SaveStatus;
  message?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {status && (
          <span
            role="status"
            className={cn(
              "text-xs",
              status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {saveStatusText(status)}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

const pill =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

const PRIORITY_STYLE: Record<Priority, string> = {
  must: "border-rose-200 bg-rose-50 text-rose-800",
  should: "border-sky-200 bg-sky-50 text-sky-800",
  could: "border-border bg-background text-muted-foreground",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cn(pill, PRIORITY_STYLE[priority])}>{PRIORITY_LABELS[priority]}</span>;
}

export function StoryStatusBadge({ status }: { status: Story["status"] }) {
  const style =
    status === "APPROVED"
      ? "border-transparent bg-primary text-primary-foreground"
      : status === "REJECTED"
        ? "border-border bg-muted text-muted-foreground line-through"
        : "border-border bg-secondary text-secondary-foreground";
  const label = status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Draft";
  return <span className={cn(pill, style)}>{label}</span>;
}

const KIND_STYLE: Record<CriterionKind, string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  negative: "border-rose-200 bg-rose-50 text-rose-800",
  edge: "border-amber-200 bg-amber-50 text-amber-900",
};

export function KindBadge({ kind }: { kind: CriterionKind }) {
  return <span className={cn(pill, KIND_STYLE[kind])}>{CRITERION_KIND_LABELS[kind]}</span>;
}

/** A story code chip (dependencies); removable in the editor. */
export function StoryChip({
  code,
  onRemove,
  title,
}: {
  code: string;
  onRemove?: () => void;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-xs"
    >
      {code}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove dependency ${code}`}
          className="leading-none opacity-70 hover:opacity-100"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}
