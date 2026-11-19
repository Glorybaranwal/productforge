"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, apiRequest } from "@/src/lib/api-client";
import { cn } from "@/src/lib/utils";
import { PrdContent, type PRD_SECTIONS, type PrdSectionKey } from "@/src/modules/prd/schema";
import type { Requirement } from "@/src/modules/requirements/schema";

import { ListEditor, RowsEditor, TextEditor, TracedEditor } from "./section-editors";

type Section = (typeof PRD_SECTIONS)[number];
type Status = "idle" | "pending" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 800;

/** One PRD section with its editor and autosave (PF-031). */
export function SectionCard({
  prdId,
  section,
  value,
  readOnly,
  requirements,
}: {
  prdId: string;
  section: Section;
  value: unknown;
  readOnly: boolean;
  requirements: Requirement[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<unknown>(value);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(draft);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function save(next: unknown) {
    const clean = cleanForSave(section.key, next);
    const check = PrdContent.shape[section.key].safeParse(clean);
    if (!check.success) {
      setStatus("error");
      setMessage(check.error.issues[0]?.message ?? "Check this section");
      return;
    }
    setStatus("saving");
    try {
      await apiRequest(`/api/prds/${prdId}`, {
        method: "PATCH",
        body: { section: section.key, value: check.data },
      });
      if (latest.current === next) setStatus("saved");
      setMessage(null);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Couldn't save. Your text is still here — try again.",
      );
    }
  }

  function change(next: unknown) {
    setDraft(next);
    latest.current = next;
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), AUTOSAVE_MS);
  }

  const common = { readOnly, label: section.title };
  const editor = (() => {
    switch (section.kind) {
      case "text":
        return <TextEditor {...common} value={draft as string} onChange={change} />;
      case "list":
        return <ListEditor {...common} value={draft as string[]} onChange={change} />;
      case "goals":
        return (
          <RowsEditor
            {...common}
            value={draft as { goal: string; metric: string }[]}
            onChange={change}
            empty={{ goal: "", metric: "" }}
            fields={[
              { key: "goal", label: "Goal", placeholder: "What should improve" },
              { key: "metric", label: "Metric", placeholder: "How we'll measure it" },
            ]}
          />
        );
      case "personas":
        return (
          <RowsEditor
            {...common}
            value={draft as { name: string; needs: string }[]}
            onChange={change}
            empty={{ name: "", needs: "" }}
            fields={[
              { key: "name", label: "Persona", placeholder: "Who" },
              { key: "needs", label: "Needs", placeholder: "What they need" },
            ]}
          />
        );
      case "risks":
        return (
          <RowsEditor
            {...common}
            value={draft as { risk: string; mitigation: string }[]}
            onChange={change}
            empty={{ risk: "", mitigation: "" }}
            fields={[
              { key: "risk", label: "Risk", placeholder: "What could go wrong" },
              { key: "mitigation", label: "Mitigation", placeholder: "Our plan" },
            ]}
          />
        );
      case "traced":
        return (
          <TracedEditor
            {...common}
            value={draft as never}
            onChange={change}
            requirements={requirements}
            requireLink={
              section.key === "functionalRequirements" ||
              section.key === "nonFunctionalRequirements"
            }
          />
        );
    }
  })();

  return (
    <section
      aria-labelledby={`section-${section.key}`}
      className={cn(
        "space-y-3 rounded-xl border bg-card p-5",
        section.key === "assumptions" && "border-amber-300 bg-amber-50/40",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`section-${section.key}`} className="font-semibold">
          {section.title}
        </h2>
        {!readOnly && <SaveStatus status={status} />}
      </div>
      {!readOnly && <p className="text-xs text-muted-foreground">{section.hint}</p>}
      {editor}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

/** Drops blank list lines and blank trailing rows the user is still typing. */
function cleanForSave(key: PrdSectionKey, value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return value;
  if (key === "inScope" || key === "outOfScope" || key === "dependencies") {
    return (value as string[]).map((v) => v.trim()).filter(Boolean);
  }
  return value;
}

function SaveStatus({ status }: { status: Status }) {
  const text = {
    idle: "",
    pending: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: "Not saved",
  }[status];
  return (
    <span
      role="status"
      className={cn("text-xs", status === "error" ? "text-destructive" : "text-muted-foreground")}
    >
      {text}
    </span>
  );
}
