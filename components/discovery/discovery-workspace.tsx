"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { newId } from "@/src/lib/ids";
import type { Project } from "@/src/modules/projects/schema";
import type { DiscoveryState } from "@/src/modules/requirements/discovery-service";

import { FindingsPanel } from "./findings-panel";
import { QuestionsPanel } from "./questions-panel";
import { RequirementsPanel } from "./requirements-panel";
import { SourcesPanel } from "./sources-panel";
import { useAction } from "./use-action";

type Props = { project: Project; state: DiscoveryState; canManage: boolean };

export function DiscoveryWorkspace({ project, state, canManage }: Props) {
  const { discovery, sources, requirements, questions, latestRun } = state;
  const confirmed = discovery?.status === "confirmed";
  const pendingAnswers = discovery
    ? questions.filter((q) => q.resolvedAt && q.resolvedAt > discovery.updatedAt).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Discovery &amp; clarification</h1>
          <Badge variant={confirmed ? "default" : "secondary"}>
            {confirmed
              ? "Confirmed"
              : discovery
                ? `Draft · run ${discovery.runCount}`
                : "Not started"}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Turn raw input into evidence-labelled requirements. Nothing is approved until you confirm
          at Gate 1.
        </p>
      </div>

      {!confirmed && (
        <RunBar
          projectId={project.id}
          hasSources={sources.length > 0}
          hasRun={Boolean(discovery)}
          pendingAnswers={pendingAnswers}
          canManage={canManage}
          latestRun={latestRun}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          {discovery ? (
            <>
              <RequirementsPanel
                projectId={project.id}
                requirements={requirements}
                sources={sources}
                locked={confirmed}
              />
              <FindingsPanel discovery={discovery} />
            </>
          ) : (
            <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
              {sources.length === 0
                ? "Add a source, then run discovery."
                : "Sources ready — run discovery to extract requirements."}
            </div>
          )}
        </div>
        <div className="space-y-6">
          {discovery && <GatePanel projectId={project.id} state={state} canManage={canManage} />}
          {discovery && <QuestionsPanel questions={questions} locked={confirmed} />}
          <SourcesPanel projectId={project.id} sources={sources} locked={confirmed} />
        </div>
      </div>
    </div>
  );
}

type RunBarProps = {
  projectId: string;
  hasSources: boolean;
  hasRun: boolean;
  pendingAnswers: number;
  canManage: boolean;
  latestRun: DiscoveryState["latestRun"];
};

function RunBar({
  projectId,
  hasSources,
  hasRun,
  pendingAnswers,
  canManage,
  latestRun,
}: RunBarProps) {
  const action = useAction();
  const [runError, setRunError] = useState<string | null>(null);

  async function run() {
    setRunError(null);
    const result = await action.run(() =>
      apiRequest<{ status: string; error: string | null }>(`/api/projects/${projectId}/discovery`, {
        method: "POST",
        headers: { "Idempotency-Key": newId() },
      }),
    );
    if (result?.status === "failed") setRunError(result.error ?? "The AI step failed.");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="space-y-1 text-sm">
        {action.busy ? (
          <p role="status" className="font-medium">
            Analyzing sources → validating output → saving drafts…
          </p>
        ) : pendingAnswers > 0 ? (
          <p className="font-medium">
            {pendingAnswers} answer{pendingAnswers === 1 ? "" : "s"} not applied yet — re-run to
            update requirements.
          </p>
        ) : (
          <p className="font-medium">
            {hasRun
              ? "Re-run after adding sources or answering questions."
              : "Ready when your sources are."}
          </p>
        )}
        {latestRun && (
          <p className="text-xs text-muted-foreground" data-testid="latest-run">
            Last run {formatDateTime(latestRun.createdAt)} ·{" "}
            {latestRun.provider === "demo" ? "demo engine" : latestRun.model} · {latestRun.status} ·{" "}
            {latestRun.attempts} attempt{latestRun.attempts === 1 ? "" : "s"} ·{" "}
            {(latestRun.tokensIn + latestRun.tokensOut).toLocaleString("en")} tokens
          </p>
        )}
        {(runError || action.error) && (
          <p role="alert" className="text-destructive">
            {runError ?? action.error}
          </p>
        )}
      </div>
      <Button onClick={run} disabled={!hasSources || action.busy || !canManage} size="lg">
        {action.busy ? "Running…" : hasRun ? "Re-run with answers" : "Run discovery"}
      </Button>
    </div>
  );
}

function GatePanel({
  projectId,
  state,
  canManage,
}: {
  projectId: string;
  state: DiscoveryState;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const { discovery, blockers } = state;
  const drafts = state.requirements.filter((r) => r.status === "DRAFT").length;

  if (discovery?.status === "confirmed") {
    return (
      <section
        aria-label="Gate 1"
        className="space-y-1 rounded-xl border border-primary bg-card p-5"
      >
        <h2 className="font-semibold">Gate 1 passed</h2>
        <p className="text-sm text-muted-foreground">
          Requirements confirmed by {discovery.confirmedBy} on{" "}
          {discovery.confirmedAt ? formatDateTime(discovery.confirmedAt) : "—"}. They&apos;re frozen
          now: to change, add or withdraw one,{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${discovery.projectId}/changes`}
          >
            propose a change
          </Link>{" "}
          — its impact is checked before anything changes.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Gate 1" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Gate 1 · Confirm requirements</h2>
      {blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          All questions resolved. Confirming approves {drafts} requirement{drafts === 1 ? "" : "s"}{" "}
          and locks them.
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={action.busy}
            onClick={() =>
              action.run(() =>
                apiRequest(`/api/projects/${projectId}/discovery/confirm`, { method: "POST" }),
              )
            }
          >
            {action.busy ? "Confirming…" : `Yes, approve ${drafts}`}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={action.busy}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)} disabled={blockers.length > 0 || !canManage}>
          Confirm requirements
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
