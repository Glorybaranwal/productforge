"use client";

import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import { newId } from "@/src/lib/ids";
import { TaskRow } from "@/src/modules/stories/schema";
import type { StoryView } from "@/src/modules/stories/state";

import { EditorSection } from "./editor-section";
import { useAutosave } from "./use-autosave";

type Row = { id: string; code?: string; title: string; description: string; hours: string };

const Rows = z.array(TaskRow);

/** Technical tasks with hour estimates (autosaved). */
export function TasksEditor({ story }: { story: StoryView }) {
  const { draft, change, status, message } = useAutosave<Row[]>(
    story.tasks.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      description: t.description,
      hours: String(t.estimateHours),
    })),
    (rows) => {
      const parsed = Rows.safeParse(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          estimateHours: r.hours.trim() === "" ? Number.NaN : Number(r.hours),
        })),
      );
      if (parsed.success) return { ok: true, value: parsed.data };
      const issue = parsed.error.issues[0];
      const n = typeof issue?.path[0] === "number" ? issue.path[0] + 1 : null;
      return {
        ok: false,
        message: `${n ? `Task ${n}: ` : ""}${issue?.message ?? "Check the tasks"}`,
      };
    },
    (value) =>
      apiRequest(`/api/stories/${story.id}`, {
        method: "PATCH",
        body: { section: "tasks", value },
      }),
  );
  const update = (i: number, patch: Partial<Row>) =>
    change(draft.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = draft.reduce((n, r) => n + (Number(r.hours) || 0), 0);

  return (
    <EditorSection
      title="Tasks"
      status={status}
      message={message}
      hint={`${draft.length} task${draft.length === 1 ? "" : "s"} · ${total} h in total. Split anything over 16 hours.`}
    >
      <ol className="space-y-2">
        {draft.map((row, i) => {
          const n = i + 1;
          return (
            <li
              key={row.id}
              className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto] sm:items-start"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {row.code && (
                    <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {row.code}
                    </span>
                  )}
                  <Input
                    aria-label={`Task ${n} title`}
                    className="h-8 text-sm"
                    value={row.title}
                    onChange={(e) => update(i, { title: e.target.value })}
                  />
                </div>
                <Textarea
                  aria-label={`Task ${n} description`}
                  rows={1}
                  className="min-h-9 text-sm"
                  value={row.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </div>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Hours
                <Input
                  aria-label={`Task ${n} hours`}
                  type="number"
                  min={0.5}
                  max={40}
                  step={0.5}
                  inputMode="decimal"
                  className="h-8 text-sm"
                  value={row.hours}
                  onChange={(e) => update(i, { hours: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove task ${n}`}
                onClick={() => change(draft.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => change([...draft, { id: newId(), title: "", description: "", hours: "" }])}
      >
        Add task
      </Button>
    </EditorSection>
  );
}
