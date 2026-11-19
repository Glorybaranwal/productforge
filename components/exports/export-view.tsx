"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/src/lib/format";
import type { ExportOverview } from "@/src/modules/exports/service";
import { JIRA_TARGET_LABELS, JIRA_TARGETS, type JiraTarget } from "@/src/modules/exports/schema";
import type { Project } from "@/src/modules/projects/schema";

import { ImportGuide } from "./import-guide";
import { PlanPreview } from "./plan-preview";

type Format = "csv" | "json";

const TARGET_HINT: Record<JiraTarget, string> = {
  cloud:
    "Issue ID + Parent link stories to epics and sub-tasks to stories (Epic Link is deprecated in Cloud).",
  datacenter: "Epic Name + Epic Link link stories to epics; Issue Id + Parent Id link sub-tasks.",
};

export function ExportView({ project, overview }: { project: Project; overview: ExportOverview }) {
  const router = useRouter();
  const { plan, history } = overview;
  const [target, setTarget] = useState<JiraTarget>("cloud");
  const [includeTasks, setIncludeTasks] = useState(true);
  const [subtaskType, setSubtaskType] = useState("Sub-task");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const base = `/dashboard/projects/${project.id}`;

  async function fetchFile(format: Format): Promise<{ text: string; filename: string } | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/exports/jira`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, target, includeTasks, subtaskType }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; details?: { message: string }[] };
        } | null;
        setError(
          body?.error?.details?.[0]?.message ??
            body?.error?.message ??
            "Couldn't export. Try again.",
        );
        return null;
      }
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        `jira.${format}`;
      return { text: await res.text(), filename };
    } catch {
      setError("Couldn't reach the server. Try again.");
      return null;
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function download(format: Format) {
    const file = await fetchFile(format);
    if (!file) return;
    const type = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const url = URL.createObjectURL(new Blob([file.text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: file.filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setManual(null);
    setMessage(`Downloaded ${file.filename}`);
  }

  async function copy() {
    const file = await fetchFile("csv");
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.text);
      setManual(null);
      setMessage("Copied the CSV");
    } catch {
      setManual(file.text);
      setMessage("The browser blocked copying — select the text below and copy it.");
    }
  }

  const header = (
    <div className="space-y-2">
      <Link href={base} className="text-sm text-muted-foreground hover:text-foreground">
        ← {project.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Export to Jira</h1>
        {plan.counts.stories > 0 && (
          <Badge variant={plan.gate3Passed ? "default" : "secondary"}>
            {plan.gate3Passed ? "Gate 3 passed" : "Partial backlog"}
          </Badge>
        )}
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Approved stories only, with their epics, acceptance criteria (in the description),
        requirement codes (as labels) and tasks (as sub-tasks). Drafts and rejected stories never
        leave ProductForge.
      </p>
    </div>
  );

  if (plan.counts.stories === 0) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Nothing to export yet — approve at least one story.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={overview.gate2Passed ? `${base}/backlog` : `${base}/prd`}
          >
            {overview.gate2Passed ? "Go to the backlog (Gate 3)" : "Go to the PRD (Gate 2)"}
          </Link>
        </div>
      </div>
    );
  }

  const c = plan.counts;
  return (
    <div className="space-y-6">
      {header}
      <section
        aria-label="What will be exported"
        className="space-y-3 rounded-xl border bg-card p-5"
      >
        <p className="text-sm">
          <b>{c.epics}</b> {c.epics === 1 ? "epic" : "epics"} · <b>{c.stories}</b>{" "}
          {c.stories === 1 ? "story" : "stories"} · <b>{includeTasks ? c.subtasks : 0}</b> sub-tasks
          · <b>{c.points}</b> points{includeTasks ? ` · ${c.hours} h` : ""}
          {plan.prdVersion ? ` · from PRD v${plan.prdVersion}` : ""}
        </p>
        {plan.warnings.length > 0 && (
          <ul className="space-y-1 text-sm text-amber-800">
            {plan.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Export options" className="space-y-4 rounded-xl border bg-card p-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Jira edition</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {JIRA_TARGETS.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="target"
                  value={t}
                  checked={target === t}
                  onChange={() => setTarget(t)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{JIRA_TARGET_LABELS[t]}</span>
                  <span className="block text-xs text-muted-foreground">{TARGET_HINT[t]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeTasks}
              onChange={(e) => setIncludeTasks(e.target.checked)}
            />
            Include tasks as sub-tasks
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="subtask-type">Sub-task type name on your site</Label>
            <Input
              id="subtask-type"
              className="h-9 w-40"
              value={subtaskType}
              disabled={!includeTasks}
              onChange={(e) => setSubtaskType(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => download("csv")}>
            {busy ? "Exporting…" : "Download CSV"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => download("json")}>
            Download JSON
          </Button>
          <Button variant="outline" disabled={busy} onClick={copy}>
            Copy CSV
          </Button>
        </div>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {manual && (
          <textarea
            readOnly
            aria-label="Jira CSV"
            value={manual}
            rows={8}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </section>

      <PlanPreview
        plan={plan}
        target={target}
        includeTasks={includeTasks}
        subtaskType={subtaskType || "Sub-task"}
      />
      <ImportGuide target={target} />

      <section aria-label="Export history" className="space-y-2 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Export history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exports yet. Every export is recorded here and in the activity log.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {history.map((h) => (
              <li key={`${h.at}-${h.what}`} className="flex flex-wrap justify-between gap-x-4 py-2">
                <span>
                  <b>{h.what}</b> · {h.detail}
                </span>
                <span className="text-muted-foreground">
                  {h.actor} · {formatDateTime(h.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
