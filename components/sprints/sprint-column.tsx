"use client";

import { useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import type { BoardSprint, BoardStory } from "@/src/modules/sprints/board";
import { formatDay } from "@/src/modules/sprints/schema";

import { StoryChip } from "./story-chip";

export type BoardActions = {
  busy: boolean;
  base: string;
  dragging: string | null;
  setDragging: (code: string | null) => void;
  sprintNumbers: number[];
  move: (code: string, sprint: number | null) => Promise<void>;
  updateSprint: (
    sprint: BoardSprint,
    patch: { goal?: string; capacityPoints?: number },
  ) => Promise<void>;
};

/** A place stories can be dropped: a sprint, the next new sprint, or "Not planned". */
function DropZone({
  label,
  target,
  actions,
  className,
  children,
}: {
  label: string;
  target: number | null;
  actions: BoardActions;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={label}
      data-drop={target === null ? "none" : String(target)}
      onDragOver={(e) => {
        if (!actions.dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const code = e.dataTransfer.getData("text/plain") || actions.dragging;
        actions.setDragging(null);
        if (code) void actions.move(code, target);
      }}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors",
        over && "border-primary bg-primary/5 ring-2 ring-primary/30",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Points used vs capacity; the capacity is editable in place (lower it for holidays). */
function CapacityBar({ sprint, actions }: { sprint: BoardSprint; actions: BoardActions }) {
  const { points, capacity } = sprint;
  const over = points > capacity;
  const pct =
    capacity === 0 ? (points ? 100 : 0) : Math.min(100, Math.round((points / capacity) * 100));
  const save = (value: string) => {
    const next = Number(value);
    if (value !== "" && Number.isInteger(next) && next !== capacity)
      void actions.updateSprint(sprint, { capacityPoints: next });
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("font-medium tabular-nums", over && "text-destructive")}>
          {points} / {capacity} pts
          {over ? " — over capacity" : capacity === 0 ? " · no capacity" : ""}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          Capacity
          <Input
            key={`cap:${sprint.id}:${capacity}`}
            aria-label={`Sprint ${sprint.number} capacity (points)`}
            title="Lower it for holidays"
            type="number"
            min={0}
            max={500}
            defaultValue={capacity}
            disabled={actions.busy}
            className="h-7 w-16 px-2 text-xs md:text-xs"
            onBlur={(e) => save(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SprintColumn({ sprint, actions }: { sprint: BoardSprint; actions: BoardActions }) {
  const n = sprint.number;
  const saveGoal = (value: string) => {
    if (value.trim() !== sprint.goal) void actions.updateSprint(sprint, { goal: value.trim() });
  };
  return (
    <DropZone label={`Sprint ${n}`} target={n} actions={actions}>
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Sprint {n}</h2>
          <span className="text-xs text-muted-foreground">
            {formatDay(sprint.start)} – {formatDay(sprint.end, true)}
          </span>
        </div>
        <CapacityBar sprint={sprint} actions={actions} />
        <Textarea
          key={`goal:${sprint.id}:${sprint.goal}`}
          aria-label={`Sprint ${n} goal`}
          placeholder="Sprint goal"
          defaultValue={sprint.goal}
          maxLength={300}
          rows={2}
          disabled={actions.busy}
          className="min-h-0 resize-none text-sm"
          onBlur={(e) => saveGoal(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {sprint.autoGoal && sprint.goal && (
          <p className="text-xs text-muted-foreground">
            Suggested goal — edit it to make it yours.
          </p>
        )}
      </header>
      <StoryList stories={sprint.stories} sprint={n} actions={actions} empty="Drop stories here." />
    </DropZone>
  );
}

export function NewSprintColumn({ number, actions }: { number: number; actions: BoardActions }) {
  return (
    <DropZone
      label={`New sprint ${number}`}
      target={number}
      actions={actions}
      className="border-dashed bg-transparent"
    >
      <h2 className="text-base font-semibold text-muted-foreground">Sprint {number}</h2>
      <p className="text-sm text-muted-foreground">
        Drop a story here to open sprint {number}
        {number === 1 ? " — or press Plan sprints to plan them all" : ""}.
      </p>
    </DropZone>
  );
}

export function UnplannedColumn({
  stories,
  actions,
}: {
  stories: BoardStory[];
  actions: BoardActions;
}) {
  return (
    <DropZone label="Not planned" target={null} actions={actions} className="bg-muted/40">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Not planned</h2>
        <span className="text-xs text-muted-foreground">
          {stories.reduce((n, s) => n + (s.points ?? 0), 0)} pts
        </span>
      </header>
      <StoryList
        stories={stories}
        sprint={null}
        actions={actions}
        empty="Every approved story is in a sprint."
      />
    </DropZone>
  );
}

function StoryList({
  stories,
  sprint,
  actions,
  empty,
}: {
  stories: BoardStory[];
  sprint: number | null;
  actions: BoardActions;
  empty: string;
}) {
  if (!stories.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {stories.map((s) => (
        <StoryChip key={s.code} story={s} sprint={sprint} actions={actions} />
      ))}
    </ul>
  );
}
