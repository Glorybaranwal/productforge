"use client";

import Link from "next/link";
import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import type { Prd } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";

export function GatePanel({
  state,
  latest,
  canManage,
}: {
  state: PrdState;
  latest: Prd;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction();

  if (latest.status === "APPROVED") {
    return (
      <section
        aria-label="Gate 2"
        className="space-y-1 rounded-xl border border-primary bg-card p-5"
      >
        <h2 className="font-semibold">Gate 2 passed</h2>
        <p className="text-sm text-muted-foreground">
          Version {latest.version} approved by {latest.approvedBy} on{" "}
          {latest.approvedAt ? formatDateTime(latest.approvedAt) : "—"}. Next:{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${latest.projectId}/backlog`}
          >
            build the backlog
          </Link>
          .
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Gate 2" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Gate 2 · Approve PRD</h2>
      {state.blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {state.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Every approved requirement is covered. Approving freezes version {latest.version}.
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={action.busy}
            onClick={() =>
              action.run(() => apiRequest(`/api/prds/${latest.id}/approve`, { method: "POST" }))
            }
          >
            {action.busy ? "Approving…" : `Yes, approve version ${latest.version}`}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          disabled={state.blockers.length > 0 || !canManage}
          onClick={() => setConfirming(true)}
        >
          Approve PRD
        </Button>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}
