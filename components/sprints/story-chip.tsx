"use client";

import Link from "next/link";

import { PriorityBadge } from "@/components/backlog/editor-section";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/src/lib/utils";
import type { BoardStory } from "@/src/modules/sprints/board";

import type { BoardActions } from "./sprint-column";

/**
 * One story on the board. Drag it to another sprint, or use "Move to" (keyboard and screen-reader
 * friendly) — both pin it there.
 */
export function StoryChip({
  story,
  sprint,
  actions,
}: {
  story: BoardStory;
  /** Where it is now; null = not planned. */
  sprint: number | null;
  actions: BoardActions;
}) {
  const { busy, dragging, setDragging, sprintNumbers, base } = actions;
  const next = (sprintNumbers.at(-1) ?? 0) + 1;
  const value = sprint === null ? "none" : String(sprint);
  return (
    <li
      data-story={story.code}
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", story.code);
        e.dataTransfer.effectAllowed = "move";
        setDragging(story.code);
      }}
      onDragEnd={() => setDragging(null)}
      className={cn(
        "space-y-1.5 rounded-lg border bg-background p-3 text-sm shadow-xs",
        !busy && "cursor-grab active:cursor-grabbing",
        dragging === story.code && "opacity-50",
        story.problems.length > 0 && "border-amber-300",
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          href={`${base}/backlog?story=${story.code}`}
          className="font-mono text-xs font-medium underline-offset-4 hover:underline"
        >
          {story.code}
        </Link>
        <PriorityBadge priority={story.priority} />
        <span className="ml-auto text-xs font-medium tabular-nums">
          {story.points === null ? "– pts" : `${story.points} pts`}
        </span>
      </div>
      <p className="leading-snug font-medium">{story.title}</p>
      <p className="text-xs text-muted-foreground">
        {story.epicCode} · {story.reason}
        {story.pinned && story.reason !== "Placed by hand" ? " · placed by hand" : ""}
      </p>
      {story.review.length > 0 && (
        <ul className="space-y-0.5 text-xs text-sky-800">
          {story.review.map((r) => (
            <li key={r}>Needs review after {r}</li>
          ))}
        </ul>
      )}
      {story.problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-800">
          {story.problems.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      )}
      <NativeSelect
        aria-label={`Move ${story.code} to`}
        className="h-7 text-xs"
        value={value}
        disabled={busy || (story.status !== "APPROVED" && sprint === null)}
        onChange={(e) => {
          const v = e.target.value;
          void actions.move(story.code, v === "none" ? null : Number(v));
        }}
      >
        {sprintNumbers.map((n) => (
          <option key={n} value={String(n)}>
            {n === sprint ? `In sprint ${n}` : `Move to sprint ${n}`}
          </option>
        ))}
        <option value={String(next)}>Move to a new sprint ({next})</option>
        <option value="none">{sprint === null ? "Not planned" : "Take out of the plan"}</option>
      </NativeSelect>
    </li>
  );
}
