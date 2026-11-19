"use client";

import Link from "next/link";
import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { CodeChip } from "@/components/prd/section-editors";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import type { BacklogState } from "@/src/modules/stories/state";

/** Gate 3: the backlog is approved when every live story is approved and covers its requirements. */
export function Gate3Panel({
  projectId,
  state,
  canManage,
}: {
  projectId: string;
  state: BacklogState;
  canManage: boolean;
}) {
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const { counts, gate3 } = state;

  if (gate3.passed) {
    return (
      <section
        aria-label="Gate 3"
        className="space-y-1 rounded-xl border border-primary bg-card p-5"
      >
        <h2 className="font-semibold">Gate 3 passed</h2>
        <p className="text-sm text-muted-foreground">
          {counts.approved} {counts.approved === 1 ? "story" : "stories"} approved · {counts.points}{" "}
          points. Every requirement has an approved story. Next:{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${projectId}/traceability`}
          >
            check traceability
          </Link>
          , then{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${projectId}/export`}
          >
            export to Jira
          </Link>
          .
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Gate 3" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Gate 3 · Approve backlog</h2>
      <p className="text-sm">
        <b>{counts.approved}</b> approved · <b>{counts.draft}</b> draft · <b>{counts.rejected}</b>{" "}
        rejected
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {gate3.blockers.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={action.busy}
            onClick={async () => {
              await action.run(() =>
                apiRequest(`/api/projects/${projectId}/backlog/approve`, { method: "POST" }),
              );
              setConfirming(false);
            }}
          >
            {action.busy ? "Approving…" : `Yes, approve ${counts.ready}`}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={counts.ready === 0 || !canManage} onClick={() => setConfirming(true)}>
          Approve {counts.ready} ready {counts.ready === 1 ? "story" : "stories"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Ready means linked to approved requirements, ≥ 2 criteria with a negative or edge case, and
        estimated tasks.
      </p>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}

export function CoveragePanel({ state }: { state: BacklogState }) {
  const { coverage, requirements } = state;
  const byCode = new Map(requirements.map((r) => [r.code, r]));
  const total = coverage.required.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <section aria-label="Coverage" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Requirement coverage</h2>
      <Bar
        label="With a story"
        value={coverage.covered.length}
        total={total}
        pct={pct(coverage.covered.length)}
      />
      <Bar
        label="With an approved story"
        value={coverage.approvedCovered.length}
        total={total}
        pct={pct(coverage.approvedCovered.length)}
      />
      {coverage.uncovered.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">No story yet — use “Fill gaps” or add one</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Requirements without a story">
            {coverage.uncovered.map((c) => (
              <CodeChip key={c} code={c} requirement={byCode.get(c)} />
            ))}
          </div>
        </div>
      )}
      {coverage.waiting.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Waiting on an answer (open questions get no story)</p>
          <div className="flex flex-wrap gap-1.5">
            {coverage.waiting.map((c) => (
              <CodeChip key={c} code={c} requirement={byCode.get(c)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Bar({
  label,
  value,
  total,
  pct,
}: {
  label: string;
  value: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="space-y-1">
      <p className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span>
          <b>{value}</b> / {total}
        </span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
