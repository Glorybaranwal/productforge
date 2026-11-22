"use client";

import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { RunProgressNote } from "@/components/runs/run-progress-note";
import { useRunProgress } from "@/components/runs/use-run-progress";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { newId } from "@/src/lib/ids";
import type { Prd } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";
import type { Project } from "@/src/modules/projects/schema";

export type ToolbarProps = {
  project: Project;
  state: PrdState;
  selected: Prd | undefined;
  onSelect: (id: string) => void;
  mode: "edit" | "compare";
  onMode: (mode: "edit" | "compare") => void;
  canManage: boolean;
};

export function Toolbar({
  project,
  state,
  selected,
  onSelect,
  mode,
  onMode,
  canManage,
}: ToolbarProps) {
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
