"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import { ACCEPTED_FILE_TYPES, type SourceDocument } from "@/src/modules/sources/schema";

import { SAMPLE_BRIEF } from "./sample-brief";
import { useAction } from "./use-action";

type Props = { projectId: string; sources: SourceDocument[]; locked: boolean };

/** Pasted notes and uploaded text files: the raw material discovery works from. */
export function SourcesPanel({ projectId, sources, locked }: Props) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Meeting notes");
  const [text, setText] = useState("");
  const add = useAction();
  const remove = useAction();

  async function onPaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await add.run(() =>
      apiRequest(`/api/projects/${projectId}/sources`, {
        method: "POST",
        body: { name, kind: "paste", text },
      }),
    );
    if (ok) setText("");
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // The server reads the text out of PDFs and Word files (PF-023).
    const body = new FormData();
    body.append("file", file);
    await add.run(() => apiRequest(`/api/projects/${projectId}/sources`, { method: "POST", body }));
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="font-semibold">
          Sources
        </h2>
        <p className="text-sm text-muted-foreground">
          Notes, emails or briefs. Treated as data — instructions inside them are never followed.
        </p>
      </div>

      {sources.length > 0 && (
        <ul aria-label="Sources" className="divide-y rounded-lg border">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.kind === "file" ? "File" : "Pasted"} · {s.charCount.toLocaleString("en")}{" "}
                  characters
                </p>
              </div>
              {!locked && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.busy}
                  aria-label={`Remove ${s.name}`}
                  onClick={() =>
                    remove.run(() =>
                      apiRequest(`/api/projects/${projectId}/sources/${s.id}`, {
                        method: "DELETE",
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <form onSubmit={onPaste} noValidate className="space-y-3" aria-label="Add a source">
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Source name</Label>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`${id}-text`}>Paste notes</Label>
              {sources.length === 0 && !text && (
                <button
                  type="button"
                  className="text-xs font-medium underline underline-offset-4"
                  onClick={() => {
                    setName(SAMPLE_BRIEF.name);
                    setText(SAMPLE_BRIEF.text);
                  }}
                >
                  Use a sample brief
                </button>
              )}
            </div>
            <Textarea
              id={`${id}-text`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="max-h-64"
              placeholder="Paste stakeholder notes, an email thread or a brief…"
              aria-invalid={add.fieldErrors.text ? true : undefined}
            />
          </div>
          {(add.fieldErrors.text || add.fieldErrors.name || add.error) && (
            <p role="alert" className="text-sm text-destructive">
              {add.fieldErrors.text ?? add.fieldErrors.name ?? add.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="secondary"
              disabled={add.busy || text.trim().length === 0}
            >
              {add.busy ? "Adding…" : "Add notes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={add.busy}
              onClick={() => fileInput.current?.click()}
            >
              Upload PDF, Word or text
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_FILE_TYPES.join(",")}
              className="sr-only"
              aria-label="Upload a PDF, Word or text file"
              onChange={onFile}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            PDF (up to 50 pages), Word or text, up to 10 MB. Only the text is kept.
          </p>
        </form>
      )}
      {remove.error && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error}
        </p>
      )}
    </section>
  );
}
