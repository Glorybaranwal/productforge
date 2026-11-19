"use client";

import Link from "next/link";
import { useState } from "react";

import { EvidenceBadge } from "@/components/discovery/badges";
import { useAction } from "@/components/discovery/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { cn } from "@/src/lib/utils";
import {
  CHANGE_KIND_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  type Severity,
} from "@/src/modules/impact/schema";
import type { ChangeView, ReviewItem } from "@/src/modules/impact/view";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-800",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};
const pill =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cn(pill, SEVERITY_STYLE[severity])}>{SEVERITY_LABELS[severity]}</span>;
}

const STATE_LABEL: Record<ReviewItem["state"], string> = {
  pending: "Needs review",
  reviewed: "Reviewed",
  updated: "Updated",
  rejected: "Story rejected",
  gone: "Nothing to review",
};

/** One change request: what changes, its impact, and — once approved — the review checklist. */
export function ChangeCard({ change, canManage }: { change: ChangeView; canManage: boolean }) {
  const action = useAction();
  const [confirm, setConfirm] = useState<"approve" | "discard" | null>(null);
  const post = (path: string) =>
    action.run(() => apiRequest(`/api/changes/${change.id}/${path}`, { method: "POST" }));
  const items = [...(change.impact?.items ?? [])].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.ref.localeCompare(b.ref),
  );
  const flagged = change.affected.stories.length + (change.affected.prd ? 1 : 0);
  const stories = change.affected.stories.length;
  const reach = [
    change.affected.prd ? "the PRD" : null,
    stories ? `${stories} ${stories === 1 ? "story" : "stories"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <article
      id={change.code}
      aria-label={`${change.code} ${change.title}`}
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            <span className="font-mono text-sm text-muted-foreground">{change.code}</span>{" "}
            {change.title}
          </h2>
          <Badge
            variant={
              change.status === "APPROVED"
                ? "default"
                : change.status === "DRAFT"
                  ? "secondary"
                  : "outline"
            }
          >
            {change.status === "APPROVED"
              ? "Approved"
              : change.status === "DRAFT"
                ? "Proposed"
                : "Discarded"}
          </Badge>
          <span className="text-xs text-muted-foreground">{CHANGE_KIND_LABELS[change.kind]}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Proposed by {change.createdBy} · {formatDateTime(change.createdAt)}
          {change.decidedAt &&
            ` · ${change.status === "APPROVED" ? "approved" : "discarded"} by ${change.decidedBy} · ${formatDateTime(change.decidedAt)}`}
        </p>
      </header>

      <dl className="grid gap-2 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
        {change.before && (
          <>
            <dt className="text-muted-foreground">
              {change.requirementCode} v{change.fromVersion}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-2">
              <span
                className={cn(change.kind !== "withdraw" && "text-muted-foreground line-through")}
              >
                {change.before.text}
              </span>
              <EvidenceBadge evidence={change.before.evidence} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">
          {change.kind === "withdraw"
            ? "Becomes"
            : change.toVersion
              ? `${change.requirementCode} v${change.toVersion}`
              : "Becomes"}
        </dt>
        <dd className="flex flex-wrap items-baseline gap-2">
          {change.after ? (
            <>
              {change.after.text} <EvidenceBadge evidence={change.after.evidence} />
            </>
          ) : (
            <span className="font-medium">Withdrawn — out of scope</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Why</dt>
        <dd>{change.reason}</dd>
      </dl>

      <section aria-label={`Impact of ${change.code}`} className="space-y-2">
        <h3 className="text-sm font-semibold">
          {change.status === "REJECTED"
            ? "Impact (not applied)"
            : `Impact · ${
                reach
                  ? `${reach} ${change.status === "APPROVED" ? "flagged for review" : "would need review"}`
                  : "nothing built on it yet"
              }`}
        </h3>
        {change.impact ? (
          <>
            <p className="text-sm">{change.impact.summary}</p>
            {items.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {items.map((i) => (
                  <li
                    key={i.ref}
                    className="grid gap-1 px-3 py-2 sm:grid-cols-[130px_120px_minmax(0,1fr)]"
                  >
                    <span className="font-mono text-xs">{i.ref}</span>
                    <span>
                      <SeverityBadge severity={i.severity} />
                    </span>
                    <span className="text-muted-foreground">{i.explanation}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              The items come from the requirement links; the explanations are AI-written — check
              them.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No analysis yet.</p>
        )}
        {change.needsAnalysis && change.impact && (
          <p className="text-xs text-amber-800">⚠ The backlog changed since this analysis ran.</p>
        )}
      </section>

      {change.status === "DRAFT" && canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {confirm ? (
            <>
              <span className="text-sm">
                {confirm === "approve"
                  ? change.kind === "add"
                    ? "Add this requirement? The PRD will need review."
                    : `Approve ${change.code}? ${change.requirementCode} becomes version ${(change.fromVersion ?? 0) + 1}${flagged ? ` and ${flagged} ${flagged === 1 ? "item needs" : "items need"} review` : ""}.`
                  : `Discard ${change.code}? Nothing changes.`}
              </span>
              <Button
                variant={confirm === "approve" ? "default" : "destructive"}
                disabled={action.busy}
                onClick={async () => {
                  await post(confirm);
                  setConfirm(null);
                }}
              >
                {confirm === "approve"
                  ? `Yes, approve ${change.code}`
                  : `Yes, discard ${change.code}`}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirm("approve")}>Approve change</Button>
              <Button variant="outline" onClick={() => setConfirm("discard")}>
                Discard
              </Button>
              {change.needsAnalysis && (
                <Button variant="outline" disabled={action.busy} onClick={() => post("analyze")}>
                  {action.busy ? "Analysing…" : "Run the analysis again"}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {change.status === "APPROVED" && change.review.length > 0 && (
        <ReviewChecklist change={change} canManage={canManage} />
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </article>
  );
}

function ReviewChecklist({ change, canManage }: { change: ChangeView; canManage: boolean }) {
  const action = useAction();
  return (
    <section aria-label={`Review of ${change.code}`} className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">
        Review · {change.pending ? `${change.pending} of ${change.review.length} to do` : "done"}
      </h3>
      <ul className="space-y-2 text-sm">
        {change.review.map((r) => (
          <li key={r.ref} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={r.href} className="font-medium underline-offset-4 hover:underline">
              {r.label}
            </Link>
            <span
              className={cn(
                "text-xs",
                r.state === "pending" ? "font-medium text-sky-800" : "text-muted-foreground",
              )}
            >
              {STATE_LABEL[r.state]}
              {r.state === "reviewed" && r.reviewedBy
                ? ` by ${r.reviewedBy}${r.note ? ` — “${r.note}”` : ""}`
                : ""}
              {r.state === "updated" && r.version ? ` — now v${r.version}` : ""}
            </span>
            {r.state === "pending" && canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.busy}
                onClick={() =>
                  action.run(() =>
                    apiRequest(`/api/changes/${change.id}/reviews`, {
                      method: "POST",
                      body: { ref: r.ref },
                    }),
                  )
                }
              >
                Mark {r.ref === "PRD" ? "the PRD" : r.ref} reviewed
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        An item clears when it gets a new version after the change (edit the story or the PRD as a
        new version), when the story is rejected, or when you mark it reviewed because nothing needs
        to change.
      </p>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}
