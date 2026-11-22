"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import {
  EVIDENCE,
  EVIDENCE_LABELS,
  type Evidence,
  type Requirement,
} from "@/src/modules/requirements/schema";
import type { SourceDocument } from "@/src/modules/sources/schema";

import { AddRequirement } from "./add-requirement";
import { RequirementHistoryPanel } from "./requirement-history";
import { EvidenceBadge, StatusBadge, TypeBadge } from "./badges";
import { useAction } from "./use-action";

type Props = {
  projectId: string;
  requirements: Requirement[];
  sources: SourceDocument[];
  locked: boolean;
};

export function RequirementsPanel({ projectId, requirements, sources, locked }: Props) {
  const active = requirements.filter((r) => r.status !== "REJECTED");
  const rejected = requirements.filter((r) => r.status === "REJECTED");
  const sourceName = (id: string | null) =>
    id === "answers"
      ? "your clarification answers"
      : (sources.find((s) => s.id === id)?.name ?? "a source");

  return (
    <section aria-labelledby="requirements-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="requirements-title" className="text-lg font-semibold">
          Requirements <span className="text-muted-foreground">({active.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Every item carries an evidence label and links to its source.
        </p>
      </div>
      <ul aria-label="Requirements" className="space-y-3">
        {active.map((r) => (
          <RequirementItem
            key={r.id}
            requirement={r}
            sourceName={sourceName(r.sourceId)}
            locked={locked}
            projectId={projectId}
          />
        ))}
      </ul>
      {rejected.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Rejected ({rejected.length})
          </summary>
          <ul aria-label="Rejected requirements" className="mt-3 space-y-3">
            {rejected.map((r) => (
              <RequirementItem
                key={r.id}
                requirement={r}
                sourceName={sourceName(r.sourceId)}
                locked={locked}
                projectId={projectId}
              />
            ))}
          </ul>
        </details>
      )}
      {!locked && <AddRequirement projectId={projectId} />}
    </section>
  );
}

function RequirementItem({
  requirement: r,
  sourceName,
  locked,
  projectId,
}: {
  requirement: Requirement;
  sourceName: string;
  locked: boolean;
  projectId: string;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [text, setText] = useState(r.text);
  const [type, setType] = useState(r.type);
  const [evidence, setEvidence] = useState<Evidence>(r.evidence);
  const action = useAction();
  const patch = (body: Record<string, unknown>) =>
    action.run(() => apiRequest(`/api/requirements/${r.id}`, { method: "PATCH", body }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await patch({ text, type, evidence })) setEditing(false);
  }

  return (
    <li className="space-y-2 rounded-xl border bg-card p-4" aria-label={`${r.code} ${r.text}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{r.code}</span>
        {r.version > 1 && <span className="text-xs text-muted-foreground">v{r.version}</span>}
        <EvidenceBadge evidence={r.evidence} />
        <TypeBadge type={r.type} />
        <StatusBadge status={r.status} />
        {r.origin !== "ai" && (
          <span className="text-xs text-muted-foreground">
            {r.origin === "human" ? "Added by you" : "Edited"}
          </span>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="space-y-3" aria-label={`Edit ${r.code}`}>
          <Label htmlFor={`${id}-text`} className="sr-only">
            Requirement text
          </Label>
          <Textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-type`}>Type</Label>
              <NativeSelect
                id={`${id}-type`}
                value={type}
                onChange={(e) => setType(e.target.value as Requirement["type"])}
              >
                <option value="functional">Functional</option>
                <option value="non_functional">Non-functional</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-evidence`}>Evidence</Label>
              <NativeSelect
                id={`${id}-evidence`}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value as Evidence)}
              >
                {EVIDENCE.map((e) => (
                  <option key={e} value={e}>
                    {EVIDENCE_LABELS[e]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={action.busy}>
              {action.busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p
          className={
            r.status === "REJECTED" ? "text-sm text-muted-foreground line-through" : "text-sm"
          }
        >
          {r.text}
        </p>
      )}

      {r.sourceQuote ? (
        <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
          “{r.sourceQuote}” <span className="whitespace-nowrap">— {sourceName}</span>
        </blockquote>
      ) : (
        r.rationale && <p className="text-xs text-muted-foreground">Why: {r.rationale}</p>
      )}

      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
      {r.version > 1 && (
        <div>
          <Button
            size="sm"
            variant="outline"
            aria-expanded={comparing}
            aria-controls={`${id}-history`}
            onClick={() => setComparing((open) => !open)}
          >
            {comparing ? "Hide comparison" : "Compare versions"}
          </Button>
        </div>
      )}
      {comparing && (
        <RequirementHistoryPanel projectId={projectId} code={r.code} id={`${id}-history`} />
      )}
      {!locked && !editing && (
        <div className="flex gap-1">
          {r.status === "REJECTED" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.busy}
              onClick={() => patch({ status: "DRAFT" })}
            >
              Restore
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${r.code}`}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.busy}
                onClick={() => patch({ status: "REJECTED" })}
                aria-label={`Reject ${r.code}`}
              >
                Reject
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
