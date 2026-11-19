"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SprintBoard } from "@/src/modules/sprints/board";
import { formatDay } from "@/src/modules/sprints/schema";

export type SettingsValue = { velocity: number | string; startDate: string };

/** Velocity, start date, the forecast and the Plan button (PF-051). Remount it (key) when settings change. */
export function SprintSettings({
  board,
  busy,
  fieldErrors,
  onSave,
  onPlan,
}: {
  board: SprintBoard;
  busy: boolean;
  fieldErrors: Record<string, string>;
  onSave: (value: SettingsValue) => void;
  onPlan: (value: SettingsValue | null, keepPinned: boolean) => void;
}) {
  const s = board.settings;
  const [velocity, setVelocity] = useState(String(s.velocity));
  const [startDate, setStartDate] = useState(s.startDate);
  const [keepPinned, setKeepPinned] = useState(true);
  const dirty = velocity !== String(s.velocity) || startDate !== s.startDate;
  const value = { velocity, startDate };
  const pinned = board.sprints.reduce((n, sp) => n + sp.stories.filter((x) => x.pinned).length, 0);
  const planned = board.forecast.sprints > 0;
  const f = board.forecast;
  return (
    <section aria-label="Capacity and dates" className="space-y-4 rounded-xl border bg-card p-5">
      <form
        noValidate
        aria-label="Sprint settings"
        className="flex flex-wrap items-start gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <div className="w-56 space-y-1.5">
          <Label htmlFor="velocity">Velocity (points per sprint)</Label>
          <Input
            id="velocity"
            type="number"
            min={1}
            max={500}
            value={velocity}
            onChange={(e) => setVelocity(e.target.value)}
            aria-invalid={Boolean(fieldErrors.velocity)}
            aria-describedby="velocity-hint"
          />
          {fieldErrors.velocity && (
            <p className="text-xs text-destructive">{fieldErrors.velocity}</p>
          )}
        </div>
        <div className="w-48 space-y-1.5">
          <Label htmlFor="start-date">Sprint 1 starts</Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-invalid={Boolean(fieldErrors.startDate)}
          />
          {fieldErrors.startDate && (
            <p className="text-xs text-destructive">{fieldErrors.startDate}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm leading-none font-medium select-none" aria-hidden>
            &nbsp;
          </span>
          <Button type="submit" variant="outline" disabled={busy || !dirty}>
            Save
          </Button>
        </div>
        <p id="velocity-hint" className="basis-full text-xs text-muted-foreground">
          Suggested starting velocity: {board.suggestedVelocity} points ({board.teamSize}{" "}
          {board.teamSize === 1 ? "person" : "people"} × 5 points per two weeks
          {board.sprintLengthDays !== 14 ? `, scaled to ${board.sprintLengthDays}-day sprints` : ""}
          ). Replace it with your team&apos;s real number after a sprint or two. Lower one
          sprint&apos;s capacity on the board for holidays.
        </p>
      </form>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
        <Button
          disabled={busy}
          onClick={() => onPlan(dirty || !s.saved ? value : null, keepPinned)}
        >
          {planned ? "Re-plan" : "Plan sprints"}
        </Button>
        {pinned > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepPinned}
              onChange={(e) => setKeepPinned(e.target.checked)}
            />
            Keep the {pinned === 1 ? "story" : `${pinned} stories`} placed by hand
          </label>
        )}
        <p className="text-sm" data-testid="forecast">
          {planned && f.end ? (
            <>
              Forecast: <b>{f.sprints}</b> {f.sprints === 1 ? "sprint" : "sprints"} ·{" "}
              <b>{f.points}</b> points · done by <b>{formatDay(f.end, true)}</b>
            </>
          ) : (
            <span className="text-muted-foreground">Not planned yet.</span>
          )}
        </p>
      </div>
    </section>
  );
}
