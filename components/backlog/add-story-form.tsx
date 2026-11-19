"use client";

import { useState, type FormEvent } from "react";

import { useAction } from "@/components/discovery/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiRequest } from "@/src/lib/api-client";
import type { Requirement } from "@/src/modules/requirements/schema";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  type Epic,
  type Priority,
  type Story,
} from "@/src/modules/stories/schema";

/** Write a story by hand; criteria and tasks come from “Fill gaps” or the editor. */
export function AddStoryForm({
  projectId,
  epics,
  requirements,
  onDone,
}: {
  projectId: string;
  epics: Epic[];
  requirements: Requirement[];
  onDone: (code: string | null) => void;
}) {
  const action = useAction();
  const [form, setForm] = useState({
    epicId: epics[0]?.id ?? "",
    title: "",
    asA: "",
    iWant: "to ",
    soThat: "",
    priority: "should" as Priority,
    requirement: "",
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });
  const err = (key: string) => action.fieldErrors[key];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { requirement, ...rest } = form;
    const result = await action.run(() =>
      apiRequest<{ story: Story }>(`/api/projects/${projectId}/stories`, {
        method: "POST",
        body: { ...rest, requirementCodes: requirement ? [requirement] : [] },
      }),
    );
    if (result) onDone(result.story.code);
  }

  const field = (key: "title" | "asA" | "iWant" | "soThat", label: string, placeholder: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`new-${key}`}>{label}</Label>
      <Input
        id={`new-${key}`}
        value={form[key]}
        placeholder={placeholder}
        onChange={set(key)}
        aria-invalid={!!err(key)}
      />
      {err(key) && <p className="text-xs text-destructive">{err(key)}</p>}
    </div>
  );

  return (
    <form
      aria-label="Add a story"
      onSubmit={submit}
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <h2 className="font-semibold">Add a story</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("title", "Title", "Export transactions to CSV")}
        <div className="space-y-1.5">
          <Label htmlFor="new-epic">Epic</Label>
          <NativeSelect id="new-epic" value={form.epicId} onChange={set("epicId")}>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        {field("asA", "As a", "customer")}
        {field("iWant", "I want", "to export my transactions to CSV")}
        {field("soThat", "So that", "I can do my own budgeting")}
        <div className="space-y-1.5">
          <Label htmlFor="new-priority">Priority</Label>
          <NativeSelect id="new-priority" value={form.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-requirement">Requirement it implements</Label>
          <NativeSelect
            id="new-requirement"
            value={form.requirement}
            onChange={set("requirement")}
            aria-invalid={!!err("requirementCodes")}
          >
            <option value="">Choose a requirement</option>
            {requirements.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} · {r.text.slice(0, 70)}
              </option>
            ))}
          </NativeSelect>
          {err("requirementCodes") && (
            <p className="text-xs text-destructive">{err("requirementCodes")}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={action.busy}>
          {action.busy ? "Adding…" : "Add story"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
      {action.error && !Object.keys(action.fieldErrors).length && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </form>
  );
}
