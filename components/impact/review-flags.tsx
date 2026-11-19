"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useAction } from "@/components/discovery/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/src/lib/api-client";
import type { ReviewFlag } from "@/src/modules/impact/flags";
import { SEVERITY_LABELS } from "@/src/modules/impact/schema";

/**
 * "Needs review" on one item (the PRD or a story, PF-053): which change flagged it, why, and a way
 * to clear it when nothing needs to change. Updating the item (a new version) clears it too.
 */
export function ReviewFlags({
  flags,
  refId,
  projectId,
  canManage,
  hint,
}: {
  flags: ReviewFlag[];
  /** "PRD" or a story code. */
  refId: string;
  projectId: string;
  canManage: boolean;
  hint?: ReactNode;
}) {
  const action = useAction();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!flags.length) return null;

  const mark = async (changeId: string) => {
    const done = await action.run(() =>
      apiRequest(`/api/changes/${changeId}/reviews`, {
        method: "POST",
        body: { ref: refId, note },
      }),
    );
    if (done !== undefined) {
      setNoteFor(null);
      setNote("");
    }
  };

  return (
    <section
      aria-label={`Needs review: ${refId}`}
      className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"
    >
      <p className="font-medium">Needs review after a requirement change</p>
      <ul className="space-y-2">
        {flags.map((f) => (
          <li key={f.changeId} className="space-y-1">
            <p>
              <Link
                href={`/dashboard/projects/${projectId}/changes`}
                className="font-medium underline underline-offset-4"
              >
                {f.change}
              </Link>
              : {f.title}
              {f.severity ? ` · ${SEVERITY_LABELS[f.severity]}` : ""}
            </p>
            {f.explanation && <p className="text-xs">{f.explanation}</p>}
            {canManage &&
              (noteFor === f.changeId ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mark(f.changeId);
                  }}
                >
                  <Input
                    aria-label="Review note (optional)"
                    placeholder="Note (optional)"
                    value={note}
                    maxLength={300}
                    onChange={(e) => setNote(e.target.value)}
                    className="h-8 max-w-xs bg-background text-sm"
                  />
                  <Button type="submit" size="sm" disabled={action.busy}>
                    {action.busy ? "Saving…" : "Confirm reviewed"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  onClick={() => setNoteFor(f.changeId)}
                >
                  Mark reviewed — no change needed
                </Button>
              ))}
          </li>
        ))}
      </ul>
      {hint && <p className="text-xs">{hint}</p>}
      {action.error && (
        <p role="alert" className="text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}

/** A read-only summary for pages that list many items (backlog, sprint board). */
export function ReviewSummary({
  projectId,
  items,
  changes,
  action,
}: {
  projectId: string;
  /** "US-003" or "US-003 (sprint 1)". */
  items: string[];
  changes: string[];
  action: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section
      aria-label="Requirement changes to review"
      className="space-y-1 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950"
    >
      <h2 className="font-semibold">
        {items.length === 1 ? "1 story needs" : `${items.length} stories need`} review after{" "}
        {changes.join("; ")}
      </h2>
      <p>
        {items.join(", ")}. {action}{" "}
        <Link
          href={`/dashboard/projects/${projectId}/changes`}
          className="font-medium underline underline-offset-4"
        >
          See the changes
        </Link>
      </p>
    </section>
  );
}

/** The PRD's banner: the approved version predates a requirement change. */
export function PrdReviewBanner({
  flags,
  projectId,
  canManage,
  approvedVersion,
  latestVersion,
}: {
  flags: ReviewFlag[];
  projectId: string;
  canManage: boolean;
  approvedVersion: number | null;
  latestVersion: number | null;
}) {
  if (!flags.length || approvedVersion === null) return null;
  const next = approvedVersion + 1;
  return (
    <ReviewFlags
      flags={flags}
      refId="PRD"
      projectId={projectId}
      canManage={canManage}
      hint={
        latestVersion !== null && latestVersion > approvedVersion
          ? `Version ${latestVersion} is in draft: update it and approve it (Gate 2), or mark version ${approvedVersion} reviewed if nothing needs to change.`
          : `Use "Edit as version ${next}" to update the PRD and approve it again (Gate 2), or mark it reviewed if nothing needs to change.`
      }
    />
  );
}
