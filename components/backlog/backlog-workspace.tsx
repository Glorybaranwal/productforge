"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { ReviewSummary } from "@/components/impact/review-flags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/src/lib/api-client";
import { formatDateTime } from "@/src/lib/format";
import { newId } from "@/src/lib/ids";
import type { Project } from "@/src/modules/projects/schema";
import type { BacklogState } from "@/src/modules/stories/state";

import { AddStoryForm } from "./add-story-form";
import { CoveragePanel, Gate3Panel } from "./gate-panel";
import { StoryCard } from "./story-card";

type Props = {
  project: Project;
  state: BacklogState;
  canManage: boolean;
  /** Story code to open and scroll to (from `?story=US-003`, e.g. a traceability link). */
  initialStory?: string;
};

const STAGE_LABEL = { story: "Stories", qa: "Criteria", task: "Tasks" } as Record<string, string>;

export function BacklogWorkspace({ project, state, canManage, initialStory }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set(initialStory ? [initialStory] : []));
  useEffect(() => {
    if (initialStory)
      document.getElementById(`story-${initialStory}`)?.scrollIntoView({ block: "start" });
  }, [initialStory]);
  const [adding, setAdding] = useState(false);
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

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
          <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
          {state.stories.length > 0 && (
            <Badge variant={state.gate3.passed ? "default" : "secondary"}>
              {state.gate3.passed
                ? "Gate 3 passed"
                : `${state.counts.approved} of ${state.stories.length - state.counts.rejected} approved`}
            </Badge>
          )}
          {state.stories.length > 0 && (
            <Link
              href={`/dashboard/projects/${project.id}/traceability`}
              className="text-sm font-medium underline underline-offset-4"
            >
              Traceability →
            </Link>
          )}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Epics, user stories, Given/When/Then criteria and estimated tasks, generated from the
          approved PRD. Every story links to the requirements it implements. Approve stories to
          freeze them (Gate 3).
        </p>
      </div>

      {!state.gate2Passed ? (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Approve the PRD first.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${project.id}/prd`}
          >
            Go to the PRD (Gate 2)
          </Link>
        </div>
      ) : (
        <>
          <ReviewSummary
            projectId={project.id}
            items={state.review.stories}
            changes={state.review.changes}
            action="Open each story to update it or mark it reviewed; Gate 3 waits for them."
          />
          <Toolbar
            project={project}
            state={state}
            canManage={canManage}
            adding={adding}
            onAdd={() => setAdding(true)}
          />
          {adding && (
            <AddStoryForm
              projectId={project.id}
              epics={state.epics}
              requirements={state.requirements.filter((r) => r.evidence !== "OPEN_QUESTION")}
              onDone={(code) => {
                setAdding(false);
                if (code) setOpen((prev) => new Set(prev).add(code));
              }}
            />
          )}
          {state.stories.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
              PRD version {state.prdVersion} is approved. Generate the backlog to get epics,
              stories, criteria and tasks.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                {state.epics.map((epic) => {
                  const stories = state.stories
                    .filter((s) => s.epicId === epic.id)
                    .sort(
                      (a, b) =>
                        Number(a.status === "REJECTED") - Number(b.status === "REJECTED") ||
                        a.code.localeCompare(b.code),
                    );
                  if (!stories.length) return null;
                  const points = stories
                    .filter((s) => s.status !== "REJECTED")
                    .reduce((n, s) => n + (s.storyPoints ?? 0), 0);
                  return (
                    <section
                      key={epic.id}
                      aria-labelledby={`epic-${epic.code}`}
                      className="space-y-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 id={`epic-${epic.code}`} className="font-semibold">
                          <span className="font-mono text-xs text-muted-foreground">
                            {epic.code}
                          </span>{" "}
                          {epic.title}
                        </h2>
                        <span className="text-xs text-muted-foreground">
                          {stories.length} {stories.length === 1 ? "story" : "stories"} · {points}{" "}
                          pts
                          {epic.status === "APPROVED" ? " · approved" : ""}
                        </span>
                      </div>
                      <ul className="space-y-2" aria-label={`${epic.title} stories`}>
                        {stories.map((story) => (
                          <li key={story.code}>
                            <StoryCard
                              story={story}
                              open={open.has(story.code)}
                              onToggle={() => toggle(story.code)}
                              epics={state.epics}
                              requirements={state.requirements}
                              stories={state.stories}
                              canManage={canManage}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
              <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <Gate3Panel projectId={project.id} state={state} canManage={canManage} />
                <CoveragePanel state={state} />
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Toolbar({
  project,
  state,
  canManage,
  adding,
  onAdd,
}: {
  project: Project;
  state: BacklogState;
  canManage: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  const generate = useAction();
  const [runError, setRunError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const { pending } = state;
  const work = pending.stories + pending.criteria + pending.tasks;

  async function run() {
    setRunError(null);
    const result = await generate.run(() =>
      apiRequest<{ status: string; error: string | null }>(
        `/api/projects/${project.id}/backlog/generate`,
        {
          method: "POST",
          headers: { "Idempotency-Key": newId() },
        },
      ),
    );
    if (result?.status === "failed") setRunError(result.error ?? "The AI step failed.");
  }

  async function copy() {
    const res = await fetch(`/api/projects/${project.id}/backlog/markdown`).catch(() => null);
    if (!res?.ok) {
      setCopied("Couldn't export the backlog. Try again.");
      return;
    }
    const markdown = await res.text();
    try {
      await navigator.clipboard.writeText(markdown);
      setManualCopy(null);
      setCopied(
        `Copied ${state.counts.approved} approved ${state.counts.approved === 1 ? "story" : "stories"} as Markdown`,
      );
    } catch {
      setCopied("The browser blocked copying — select the text below and copy it.");
      setManualCopy(markdown);
    }
  }

  const label =
    state.stories.length === 0
      ? "Generate backlog"
      : work
        ? `Fill gaps (${[
            pending.stories && `${pending.stories} requirement${pending.stories === 1 ? "" : "s"}`,
            pending.criteria && `${pending.criteria} without criteria`,
            pending.tasks && `${pending.tasks} without tasks`,
          ]
            .filter(Boolean)
            .join(", ")})`
        : "Backlog up to date";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      <Button
        disabled={generate.busy || !canManage || (state.stories.length > 0 && !work)}
        onClick={run}
      >
        {generate.busy ? "Writing stories, criteria and tasks…" : label}
      </Button>
      {state.stories.length > 0 && (
        <>
          <Button variant="outline" disabled={adding || !canManage} onClick={onAdd}>
            Add story
          </Button>
          <Button variant="outline" disabled={state.counts.approved === 0} onClick={copy}>
            Copy approved as Markdown
          </Button>
        </>
      )}
      <div className="w-full space-y-1 text-xs text-muted-foreground empty:hidden">
        {state.runs.length > 0 && (
          <p data-testid="latest-backlog-runs">
            Last runs:{" "}
            {state.runs
              .map(
                (r) =>
                  `${STAGE_LABEL[r.stage] ?? r.stage} ${formatDateTime(r.createdAt)} · ${r.provider === "demo" ? "demo engine" : r.model} · ${r.status}`,
              )
              .join(" | ")}
          </p>
        )}
        {copied && <p role="status">{copied}</p>}
        {manualCopy && (
          <textarea
            readOnly
            aria-label="Backlog as Markdown"
            value={manualCopy}
            rows={8}
            className="w-full rounded-md border bg-background p-2 font-mono text-xs text-foreground"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        {(runError || generate.error) && (
          <p role="alert" className="text-destructive">
            {runError ?? generate.error}
          </p>
        )}
      </div>
    </div>
  );
}
