"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { ReviewSummary } from "@/components/impact/review-flags";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/src/lib/format";
import type { Project } from "@/src/modules/projects/schema";
import type { BoardSprint, SprintBoard } from "@/src/modules/sprints/board";
import { formatDay } from "@/src/modules/sprints/schema";

import { NewSprintColumn, SprintColumn, UnplannedColumn, type BoardActions } from "./sprint-column";
import { SprintSettings, type SettingsValue } from "./sprint-settings";

type ErrorBody = { error?: { message?: string; details?: unknown } };

export function SprintView({ project, initial }: { project: Project; initial: SprintBoard }) {
  const [board, setBoard] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // One request at a time, in order, so a goal saved on blur and a move never race.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const base = `/dashboard/projects/${project.id}`;

  function call(
    path: string,
    method: string,
    body: unknown,
    done: (b: SprintBoard) => string | null,
  ) {
    const run = async (): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setFieldErrors({});
      try {
        const res = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          const e = (data as ErrorBody | null)?.error;
          const details = Array.isArray(e?.details) ? (e.details as unknown[]) : [];
          const fields = Object.fromEntries(
            details
              .filter(
                (d): d is { path: string; message: string } =>
                  typeof d === "object" && d !== null && "path" in d,
              )
              .map((d) => [d.path, d.message]),
          );
          setFieldErrors(fields);
          setMessage(null);
          setError(
            Object.keys(fields).length
              ? "Check the highlighted fields."
              : (e?.message ?? "Something went wrong. Try again."),
          );
          return false;
        }
        const next = data as SprintBoard;
        setBoard(next);
        setMessage(done(next));
        return true;
      } catch {
        setError("Couldn't reach the server. Try again.");
        return false;
      } finally {
        setBusy(false);
      }
    };
    const p = queue.current.then(run);
    queue.current = p.catch(() => false);
    return p;
  }

  const saveSettings = (v: SettingsValue) =>
    call(
      `/api/projects/${project.id}/sprints/settings`,
      "PUT",
      v,
      (b) =>
        `Saved — ${b.settings.velocity} points per sprint, sprint 1 starts ${formatDay(b.settings.startDate, true)}.`,
    );

  async function plan(v: SettingsValue | null, keepPinned: boolean) {
    if (v && !(await saveSettings(v))) return;
    await call(`/api/projects/${project.id}/sprints/plan`, "POST", { keepPinned }, (b) => {
      const stories = b.sprints.reduce((n, s) => n + s.stories.length, 0);
      return `Planned ${plural(stories, "story", "stories")} into ${plural(b.forecast.sprints, "sprint")}.`;
    });
  }

  const actions: BoardActions = {
    busy,
    base,
    dragging,
    setDragging,
    sprintNumbers: board.sprints.map((s) => s.number),
    move: async (code, sprint) => {
      await call(
        `/api/projects/${project.id}/sprints/move`,
        "POST",
        { storyCode: code, sprintNumber: sprint },
        () =>
          sprint === null ? `Took ${code} out of the plan.` : `Moved ${code} to sprint ${sprint}.`,
      );
    },
    updateSprint: async (sprint: BoardSprint, patch) => {
      await call(
        `/api/sprints/${sprint.id}`,
        "PATCH",
        patch,
        () => `Saved sprint ${sprint.number}.`,
      );
    },
  };

  const f = board.forecast;
  const header = (
    <div className="space-y-2">
      <Link href={base} className="text-sm text-muted-foreground hover:text-foreground">
        ← {project.name}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Sprint plan</h1>
        {f.sprints > 0 && f.end && (
          <Badge variant={board.warnings.length ? "secondary" : "default"}>
            {plural(f.sprints, "sprint")} · done by {formatDay(f.end)}
          </Badge>
        )}
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Approved stories only. The planner never puts a story before one it depends on, never goes
        over a sprint&apos;s capacity, and plans Must before Should before Could. Drag a story (or
        use its “Move to” menu) to change the plan — the board flags any problem a move creates.
      </p>
    </div>
  );

  if (!board.ready) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Nothing to plan yet — approve at least one story.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`${base}/backlog`}
          >
            Go to the backlog
          </Link>
        </div>
      </div>
    );
  }

  const next = (board.sprints.at(-1)?.number ?? 0) + 1;
  return (
    <div className="space-y-6">
      {header}
      <SprintSettings
        key={`${board.settings.velocity}:${board.settings.startDate}:${board.settings.saved}`}
        board={board}
        busy={busy}
        fieldErrors={fieldErrors}
        onSave={(v) => void saveSettings(v)}
        onPlan={(v, keep) => void plan(v, keep)}
      />
      <div aria-live="polite" className="space-y-2 text-sm">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      {board.warnings.length > 0 && (
        <section
          aria-label="Warnings"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            {plural(board.warnings.length, "problem")} in this plan
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {board.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        </section>
      )}
      <ReviewSummary
        projectId={project.id}
        items={board.review.stories.map((s) =>
          s.sprint ? `${s.code} (sprint ${s.sprint})` : s.code,
        )}
        changes={board.review.changes}
        action="Review them in the backlog before their sprint starts."
      />
      {board.drafts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {plural(board.drafts.length, "draft story", "draft stories")} ({board.drafts.join(", ")})
          can&apos;t be planned until approved.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`${base}/backlog`}
          >
            Review them in the backlog
          </Link>
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {board.sprints.map((sp) => (
          <SprintColumn key={sp.id} sprint={sp} actions={actions} />
        ))}
        <NewSprintColumn number={next} actions={actions} />
        <UnplannedColumn stories={board.unplanned} actions={actions} />
      </div>
    </div>
  );
}
