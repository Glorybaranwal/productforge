"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import type { Requirement } from "@/src/modules/requirements/schema";

import { useAction } from "./use-action";

export function AddRequirement({ projectId }: { projectId: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const [type, setType] = useState<Requirement["type"]>("functional");
  const action = useAction();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await action.run(() =>
      apiRequest(`/api/projects/${projectId}/requirements`, {
        method: "POST",
        body: { text, type },
      }),
    );
    if (ok) setText("");
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="New requirement"
      className="space-y-3 rounded-xl border border-dashed p-4"
    >
      <Label htmlFor={`${id}-text`}>Add a requirement</Label>
      <Textarea
        id={`${id}-text`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. Admins can export an audit log"
      />
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Requirement type"
          className="w-auto"
          value={type}
          onChange={(e) => setType(e.target.value as Requirement["type"])}
        >
          <option value="functional">Functional</option>
          <option value="non_functional">Non-functional</option>
        </NativeSelect>
        <Button
          type="submit"
          variant="secondary"
          disabled={action.busy || text.trim().length === 0}
        >
          {action.busy ? "Adding…" : "Add requirement"}
        </Button>
      </div>
      {(action.fieldErrors.text || action.error) && (
        <p role="alert" className="text-sm text-destructive">
          {action.fieldErrors.text ?? action.error}
        </p>
      )}
    </form>
  );
}
