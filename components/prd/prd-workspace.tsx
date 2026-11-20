"use client";

import Link from "next/link";
import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { RunProgressNote } from "@/components/runs/run-progress-note";
import { useRunProgress } from "@/components/runs/use-run-progress";
import { PrdReviewBanner } from "@/components/impact/review-flags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { newId } from "@/src/lib/ids";
import { PRD_SECTIONS, type Prd } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";
import type { Project } from "@/src/modules/projects/schema";

import { CompareView } from "./compare-view";
import { SectionCard } from "./section-card";

type Props = { project: Project; state: PrdState; canManage: boolean };

export function PrdWorkspace({ project, state, canManage }: Props) {
  const { versions, gate1Passed } = state;
  const latest = versions.at(-1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "compare">("edit");
  const selected = versions.find((v) => v.id === selectedId) ?? latest;
  const editable = Boolean(selected && selected.id === latest?.id && selected.status === "DRAFT");

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
          <h1 className="text-2xl font-semibold tracking-tight">Product requirements</h1>
          {selected && (
            <Badge variant={selected.status === "APPROVED" ? "default" : "secondary"}>
              Version {selected.version} · {selected.status === "APPROVED" ? "Approved" : "Draft"}
              {selected.origin === "ai_edited" ? " · AI-edited" : ""}
            </Badge>
          )}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Generated from the requirements approved at Gate 1. Every requirement links back to its
          code. Approve to freeze a version (Gate 2).
        </p>
      </div>

      <PrdReviewBanner
        flags={state.review}
        projectId={project.id}
        canManage={canManage}
        approvedVersion={
          [...versions].reverse().find((v) => v.status === "APPROVED")?.version ?? null
        }
        latestVersion={latest?.version ?? null}
      />
      {!gate1Passed ? (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Confirm the requirements first.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${project.id}/discovery`}
          >
            Go to discovery (Gate 1)
          </Link>
        </div>
      ) : (
        <>
          <Toolbar
            project={project}
            state={state}
            selected={selected}
            onSelect={setSelectedId}
            mode={mode}
            onMode={setMode}
            canManage={canManage}
          />
          {selected && mode === "compare" && versions.length > 1 ? (
            <CompareView versions={versions} />
          ) : selected ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4" key={selected.id}>
                {!editable && (
                  <p className="rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                    {selected.status === "APPROVED"
                      ? `Version ${selected.version} is approved and frozen.`
                      : "Older draft."}{" "}
                    {selected.id !== latest?.id
                      ? "Viewing an earlier version."
                      : "Start a new version to make changes."}
                  </p>
                )}
                {PRD_SECTIONS.map((section) => (
                  <SectionCard
                    key={section.key}
                    prdId={selected.id}
                    section={section}
                    value={selected.content[section.key]}
                    readOnly={!editable}
                    requirements={state.requirements}
                  />
                ))}
              </div>
              <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <GatePanel state={state} latest={latest!} canManage={canManage} />
                <TraceabilityPanel state={state} prd={selected} />
              </aside>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
              Requirements are confirmed. Generate the PRD to start.
            </div>
          )}
        </>
      )}
    </div>
  );
}

type ToolbarProps = {
  project: Project;
  state: PrdState;
  selected: Prd | undefined;
  onSelect: (id: string) => void;
  mode: "edit" | "compare";
  onMode: (mode: "edit" | "compare") => void;
  canManage: boolean;
};

function Toolbar({ project, state, selected, onSelect, mode, onMode, canManage }: ToolbarProps) {
  const generate = useAction();
  const progress = useRunProgress(project.id, ["prd"]);
  const newVersion = useAction();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const latest = state.versions.at(-1);
  const editedDraft = latest?.status === "DRAFT" && latest.origin !== "ai";

  async function run() {
    setConfirmRegenerate(false);
    setRunError(null);
    progress.start();
    const result = await generate.run(() =>
      apiRequest<{ status: string; error: string | null }>(
        `/api/projects/${project.id}/prd/generate`,
        {
          method: "POST",
          headers: { "Idempotency-Key": newId() },
        },
      ),
    );
    progress.stop();
    if (result?.status === "failed") setRunError(result.error ?? "The AI step failed.");
  }

  async function copyMarkdown() {
    if (!selected) return;
    const res = await fetch(`/api/prds/${selected.id}/markdown`).catch(() => null);
    if (!res?.ok) {
      setCopied("Couldn't export the PRD. Try again.");
      return;
    }
    const markdown = await res.text();
    try {
      await navigator.clipboard.writeText(markdown);
      setManualCopy(null);
      setCopied("Copied as Markdown");
    } catch {
      setCopied("The browser blocked copying — select the text below and copy it.");
      setManualCopy(markdown);
    }
  }

  const generateLabel = !latest
    ? "Generate PRD"
    : latest.status === "APPROVED"
      ? "Generate next version"
      : "Regenerate draft";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      {state.versions.length > 0 && (
        <NativeSelect
          aria-label="Version"
          className="w-auto"
          value={selected?.id}
          onChange={(e) => onSelect(e.target.value)}
        >
          {[...state.versions].reverse().map((v) => (
            <option key={v.id} value={v.id}>
              Version {v.version} · {v.status === "APPROVED" ? "approved" : "draft"}
            </option>
          ))}
        </NativeSelect>
      )}
      {state.versions.length > 1 && (
        <Button variant="outline" onClick={() => onMode(mode === "compare" ? "edit" : "compare")}>
          {mode === "compare" ? "Back to editor" : "Compare versions"}
        </Button>
      )}
      {selected && (
        <Button variant="outline" onClick={copyMarkdown}>
          Copy as Markdown
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {latest?.status === "APPROVED" && (
          <Button
            variant="secondary"
            disabled={newVersion.busy}
            onClick={() =>
              newVersion.run(() =>
                apiRequest(`/api/prds/${latest.id}/new-version`, { method: "POST" }),
              )
            }
          >
            {newVersion.busy ? "Creating…" : `Edit as version ${latest.version + 1}`}
          </Button>
        )}
        {confirmRegenerate ? (
          <>
            <span className="text-sm">Replace your edits in this draft?</span>
            <Button variant="destructive" onClick={run}>
              Yes, regenerate
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRegenerate(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            disabled={generate.busy || !canManage}
            variant={latest ? "outline" : "default"}
            onClick={() => (editedDraft ? setConfirmRegenerate(true) : run())}
          >
            {generate.busy ? "Writing the PRD…" : generateLabel}
          </Button>
        )}
      </div>
      <div className="w-full space-y-1 text-xs text-muted-foreground empty:hidden">
        <RunProgressNote busy={generate.busy} message={progress.message} />
        {state.latestRun && (
          <p data-testid="latest-prd-run">
            Last run {formatDateTime(state.latestRun.createdAt)} ·{" "}
            {state.latestRun.provider === "demo" ? "demo engine" : state.latestRun.model} ·{" "}
            {state.latestRun.status}
          </p>
        )}
        {copied && <p role="status">{copied}</p>}
        {manualCopy && (
          <textarea
            readOnly
            aria-label="PRD as Markdown"
            value={manualCopy}
            rows={8}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs text-foreground"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        {(runError || generate.error || newVersion.error) && (
          <p role="alert" className="text-destructive">
            {runError ?? generate.error ?? newVersion.error}
          </p>
        )}
      </div>
    </div>
  );
}

function GatePanel({
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

function TraceabilityPanel({ state, prd }: { state: PrdState; prd: Prd }) {
  const content = prd.content;
  const linked = new Set(
    [
      ...content.functionalRequirements,
      ...content.nonFunctionalRequirements,
      ...content.assumptions,
      ...content.openQuestions,
    ].flatMap((i) => i.requirementCodes),
  );
  const covered = state.requirements.filter((r) => linked.has(r.code)).length;
  const total = state.requirements.length;
  return (
    <section aria-label="Traceability" className="space-y-2 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Traceability</h2>
      <p className="text-sm">
        <span className="text-2xl font-semibold">{covered}</span>
        <span className="text-muted-foreground"> / {total} approved requirements covered</span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full bg-primary"
          style={{ width: `${total ? Math.round((covered / total) * 100) : 0}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Chip colours show each requirement&apos;s evidence: explicit, inferred, assumption, open
        question.
      </p>
    </section>
  );
}
