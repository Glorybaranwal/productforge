"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import type { ClarifyingQuestion } from "@/src/modules/requirements/schema";

import { useAction } from "./use-action";

type Props = { questions: ClarifyingQuestion[]; locked: boolean };

const STATE_LABEL: Record<ClarifyingQuestion["state"], string> = {
  open: "Open",
  answered: "Answered",
  assumption: "Assumption",
  skipped: "Skipped",
};

/** Clarification loop (PF-026): answer, assume or skip each question; re-run uses the answers. */
export function QuestionsPanel({ questions, locked }: Props) {
  const open = questions.filter((q) => q.state === "open");
  const resolved = questions.filter((q) => q.state !== "open");
  return (
    <section aria-labelledby="questions-title" className="space-y-3 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 id="questions-title" className="font-semibold">
          Clarifying questions <span className="text-muted-foreground">({open.length} open)</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Resolve each one before confirming. Re-run discovery to apply your answers.
        </p>
      </div>
      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground">Run discovery to get questions.</p>
      )}
      <ul aria-label="Open questions" className="space-y-3">
        {open.map((q) => (
          <QuestionItem key={q.id} question={q} locked={locked} />
        ))}
      </ul>
      {resolved.length > 0 && (
        <details open={open.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            Resolved ({resolved.length})
          </summary>
          <ul aria-label="Resolved questions" className="mt-3 space-y-3">
            {resolved.map((q) => (
              <QuestionItem key={q.id} question={q} locked={locked} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function QuestionItem({ question: q, locked }: { question: ClarifyingQuestion; locked: boolean }) {
  const id = useId();
  const [mode, setMode] = useState<"idle" | "answered" | "assumption">("idle");
  const [text, setText] = useState("");
  const action = useAction();
  const send = (body: Record<string, unknown>) =>
    action.run(() => apiRequest(`/api/questions/${q.id}`, { method: "PATCH", body }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "idle") return;
    if (await send({ state: mode, answer: text })) {
      setMode("idle");
      setText("");
    }
  }

  return (
    <li className="space-y-2 rounded-lg border p-3" aria-label={q.question}>
      <p className="text-sm font-medium">{q.question}</p>
      {q.reason && <p className="text-xs text-muted-foreground">{q.reason}</p>}
      {q.state !== "open" && (
        <p className="text-sm">
          <span className="text-xs font-medium text-muted-foreground">{STATE_LABEL[q.state]}</span>
          {q.answer && <span className="block">{q.answer}</span>}
        </p>
      )}

      {mode !== "idle" ? (
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor={`${id}-answer`}>
            {mode === "answered" ? "Your answer" : "What should we assume?"}
          </Label>
          <Textarea
            id={`${id}-answer`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={action.busy || !text.trim()}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        !locked && (
          <div className="flex flex-wrap gap-1">
            {q.state === "open" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setMode("answered")}>
                  Answer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("assumption")}>
                  Mark as assumption
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.busy}
                  onClick={() => send({ state: "skipped" })}
                >
                  Skip
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={action.busy}
                onClick={() => send({ state: "open" })}
              >
                Re-open
              </Button>
            )}
          </div>
        )
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </li>
  );
}
