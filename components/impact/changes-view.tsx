"use client";

import Link from "next/link";
import { useState } from "react";

import { EvidenceBadge } from "@/components/discovery/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChangesOverview } from "@/src/modules/impact/view";
import type { Project } from "@/src/modules/projects/schema";

import { ChangeCard } from "./change-card";
import { ProposeForm } from "./propose-form";

/** Change impact (PF-053): propose, analyse, approve, then review what the change touched. */
export function ChangesView({
  project,
  overview,
  canManage,
  initialRequirement,
}: {
  project: Project;
  overview: ChangesOverview;
  canManage: boolean;
  initialRequirement?: string;
}) {
  // The last proposal's outcome, shown while that change is still a proposal.
  const [message, setMessage] = useState<{ code: string; text: string } | null>(null);
  const shown =
    message && overview.changes.find((c) => c.code === message.code)?.status === "DRAFT"
      ? message.text
      : null;
  const [proposing, setProposing] = useState(
    overview.changes.length === 0 || Boolean(initialRequirement),
  );
  const base = `/dashboard/projects/${project.id}`;
  const approved = overview.changes.filter((c) => c.status === "APPROVED").length;

  const header = (
    <div className="space-y-2">
      <Link href={base} className="text-sm text-muted-foreground hover:text-foreground">
        ← {project.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Change impact</h1>
        {overview.pending > 0 ? (
          <Badge variant="secondary">{overview.pending} to review</Badge>
        ) : approved > 0 ? (
          <Badge>Up to date</Badge>
        ) : null}
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Approved requirements are never edited in place. Propose a change, see what it touches —
        PRD, stories, criteria, tasks and sprints — and approve it to create the requirement&apos;s
        next version. Everything it affected shows &ldquo;Needs review&rdquo; until it&apos;s
        updated or marked reviewed.
      </p>
    </div>
  );

  if (!overview.gate1Passed) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Requirements aren&apos;t confirmed yet — until Gate 1 you edit them directly.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`${base}/discovery`}
          >
            Go to discovery (Gate 1)
          </Link>
        </div>
      </div>
    );
  }

  const withdrawn = overview.requirements.filter((r) => r.status === "REJECTED");
  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {canManage &&
            (proposing ? (
              <ProposeForm
                key={overview.changes.length}
                projectId={project.id}
                requirements={overview.requirements}
                initialRequirement={initialRequirement}
                onProposed={(code, text) => {
                  setMessage({ code, text });
                  setProposing(false);
                }}
              />
            ) : (
              <Button onClick={() => setProposing(true)}>Propose a change</Button>
            ))}
          {shown && (
            <p role="status" className="text-sm">
              {shown}
            </p>
          )}
          {overview.changes.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
              No changes yet. The requirements are as approved at Gate 1.
            </div>
          ) : (
            <div className="space-y-4" aria-label="Change requests">
              {overview.changes.map((c) => (
                <ChangeCard key={c.id} change={c} canManage={canManage} />
              ))}
            </div>
          )}
        </div>
        <aside
          aria-label="Requirements"
          className="space-y-3 rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:self-start"
        >
          <h2 className="font-semibold">Requirements now</h2>
          <ul className="space-y-2 text-sm">
            {overview.requirements
              .filter((r) => r.status === "APPROVED")
              .map((r) => (
                <li key={r.code} className="space-y-0.5">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs">{r.code}</span>
                    <span className="text-xs text-muted-foreground">v{r.version}</span>
                    <EvidenceBadge evidence={r.evidence} />
                    {r.changedBy && (
                      <span className="text-xs text-muted-foreground">· {r.changedBy}</span>
                    )}
                    {r.proposed && (
                      <span className="text-xs font-medium text-sky-800">
                        · {r.proposed} proposed
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground">{r.text}</p>
                </li>
              ))}
          </ul>
          {withdrawn.length > 0 && (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Withdrawn: {withdrawn.map((r) => `${r.code} (${r.changedBy})`).join(", ")}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
