"use client";

import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { newId } from "@/src/lib/ids";
import type { StoryView } from "@/src/modules/stories/state";

type Mode = "idle" | "reject" | "regenerate";
type PipelineResult = { status: string; error: string | null };

/** Gate 3 for one story: approve, reject with a reason, regenerate with a note, restore, version. */
export function StoryActions({ story, canManage }: { story: StoryView; canManage: boolean }) {
  const action = useAction();
  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const post = (path: string, body?: unknown, headers?: Record<string, string>) =>
    action.run(() =>
      apiRequest<PipelineResult>(`/api/stories/${story.id}/${path}`, {
        method: "POST",
        body,
        headers,
      }),
    );

  async function regenerate() {
    setRunError(null);
    const result = await post("regenerate", { note: text }, { "Idempotency-Key": newId() });
    if (result?.status === "failed") setRunError(result.error ?? "The AI step failed.");
    else if (result) {
      setMode("idle");
      setText("");
    }
  }

  async function reject() {
    if (await post("reject", { reason: text })) {
      setMode("idle");
      setText("");
    }
  }

  const error = runError ?? action.fieldErrors.reason ?? action.fieldErrors.note ?? action.error;
  const disabled = action.busy || !canManage;

  return (
    <div className="space-y-3 border-t pt-4" aria-label={`${story.code} review`} role="group">
      {story.status === "DRAFT" && story.blockers.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">To approve, fix:</p>
          <ul
            className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground"
            aria-label={`${story.code} blockers`}
          >
            {story.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {story.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-800" aria-label={`${story.code} warnings`}>
          {story.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {story.status === "REJECTED" && (
        <p className="text-sm text-muted-foreground">
          Rejected: <span className="text-foreground">{story.rejectionReason}</span>
        </p>
      )}
      {story.status === "APPROVED" && (
        <p className="text-sm text-muted-foreground">
          Version {story.version} approved by {story.approvedBy}
          {story.approvedAt ? ` on ${formatDateTime(story.approvedAt)}` : ""}. Frozen with its
          criteria and tasks.
        </p>
      )}

      {mode !== "idle" ? (
        <div className="space-y-2">
          <Textarea
            aria-label={
              mode === "reject"
                ? `Why reject ${story.code}?`
                : `Note for regenerating ${story.code}`
            }
            placeholder={
              mode === "reject"
                ? "What's wrong with it? The reason guides the next draft."
                : "Optional: what should change? e.g. “Write it as a support agent”, “priority could-have”, “add an edge case: …”"
            }
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {mode === "regenerate" && story.origin !== "ai" && (
            <p className="text-xs text-amber-800">
              This replaces your edits to this story, its criteria and its tasks.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === "reject" ? (
              <Button variant="destructive" disabled={disabled} onClick={reject}>
                {action.busy ? "Rejecting…" : "Reject story"}
              </Button>
            ) : (
              <Button disabled={disabled} onClick={regenerate}>
                {action.busy ? "Rewriting…" : "Regenerate story"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {story.status === "DRAFT" && (
            <>
              <Button
                disabled={disabled || story.blockers.length > 0}
                onClick={() => post("approve")}
              >
                {action.busy ? "Approving…" : "Approve story"}
              </Button>
              <Button variant="outline" disabled={disabled} onClick={() => setMode("reject")}>
                Reject…
              </Button>
            </>
          )}
          {story.status === "REJECTED" && (
            <Button variant="outline" disabled={disabled} onClick={() => post("restore")}>
              Restore to draft
            </Button>
          )}
          {story.status !== "APPROVED" && (
            <Button variant="outline" disabled={disabled} onClick={() => setMode("regenerate")}>
              Regenerate with note…
            </Button>
          )}
          {story.status === "APPROVED" && (
            <Button variant="secondary" disabled={disabled} onClick={() => post("new-version")}>
              {action.busy ? "Creating…" : `Edit as version ${story.version + 1}`}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
