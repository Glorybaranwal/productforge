"use client";

import { useState } from "react";

import { useAction } from "@/components/discovery/use-action";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/src/lib/api-client";
import { newId } from "@/src/lib/ids";
import { CHANGE_KINDS, CHANGE_KIND_LABELS, type ChangeKind } from "@/src/modules/impact/schema";
import type { RequirementOption } from "@/src/modules/impact/view";
import { EVIDENCE, EVIDENCE_LABELS, type Evidence } from "@/src/modules/requirements/schema";

const KIND_HINT: Record<ChangeKind, string> = {
  modify: "New wording or evidence for an approved requirement (it becomes the next version).",
  add: "A requirement that came up after Gate 1. It gets the next code.",
  withdraw: "Take a requirement out of scope. Its history is kept.",
};

type Result = { code: string; status: string | null; error: string | null };

/** Propose a change to the approved requirements (PF-053); the impact is analysed before anything changes. */
export function ProposeForm({
  projectId,
  requirements,
  initialRequirement,
  onProposed,
}: {
  projectId: string;
  requirements: RequirementOption[];
  initialRequirement?: string;
  onProposed: (code: string, message: string) => void;
}) {
  const approved = requirements.filter((r) => r.status === "APPROVED");
  const first =
    approved.find((r) => r.code === initialRequirement) ?? approved.find((r) => !r.proposed);
  const [kind, setKind] = useState<ChangeKind>("modify");
  const [code, setCode] = useState(first?.code ?? "");
  const [text, setText] = useState(first?.text ?? "");
  const [evidence, setEvidence] = useState<Evidence>("EXPLICIT");
  const [type, setType] = useState<"functional" | "non_functional">("functional");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(() => newId());
  const action = useAction();
  const errors = action.fieldErrors;

  const pick = (next: string, k = kind) => {
    setCode(next);
    const r = approved.find((x) => x.code === next);
    if (k === "modify") setText(r?.text ?? "");
  };
  const switchKind = (k: ChangeKind) => {
    setKind(k);
    if (k === "add") setText("");
    else pick(code || (approved.find((r) => !r.proposed)?.code ?? ""), k);
  };

  async function submit() {
    const body =
      kind === "add"
        ? { kind, text, type, evidence, reason }
        : kind === "modify"
          ? { kind, requirementCode: code, text, evidence, reason }
          : { kind, requirementCode: code, reason };
    const res = await action.run(() =>
      apiRequest<Result>(`/api/projects/${projectId}/changes`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      }),
    );
    if (!res) return;
    setKey(newId());
    setReason("");
    onProposed(
      res.code,
      res.status === "failed"
        ? `${res.code} proposed, but the analysis failed: ${res.error ?? "try again"}`
        : `${res.code} proposed — check its impact below before approving.`,
    );
  }

  const current = approved.find((r) => r.code === code);
  return (
    <form
      noValidate
      aria-label="Propose a change"
      className="space-y-4 rounded-xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="font-semibold">Propose a change</h2>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What changes</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CHANGE_KINDS.map((k) => (
            <label
              key={k}
              className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="change-kind"
                value={k}
                checked={kind === k}
                onChange={() => switchKind(k)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{CHANGE_KIND_LABELS[k]}</span>
                <span className="block text-xs text-muted-foreground">{KIND_HINT[k]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind !== "add" && (
        <div className="space-y-1.5">
          <Label htmlFor="change-requirement">Requirement</Label>
          <NativeSelect
            id="change-requirement"
            value={code}
            onChange={(e) => pick(e.target.value)}
            aria-invalid={Boolean(errors.requirementCode)}
          >
            {approved.map((r) => (
              <option key={r.code} value={r.code} disabled={Boolean(r.proposed)}>
                {r.code} v{r.version} — {r.text.length > 80 ? `${r.text.slice(0, 79)}…` : r.text}
                {r.proposed ? ` (${r.proposed} open)` : ""}
              </option>
            ))}
          </NativeSelect>
          {kind === "withdraw" && current && (
            <p className="text-xs text-muted-foreground">Now: {current.text}</p>
          )}
          {errors.requirementCode && (
            <p className="text-xs text-destructive">{errors.requirementCode}</p>
          )}
        </div>
      )}

      {kind !== "withdraw" && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-1.5">
            <Label htmlFor="change-text">{kind === "add" ? "Requirement" : "New wording"}</Label>
            <Textarea
              id="change-text"
              rows={2}
              value={text}
              maxLength={400}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={Boolean(errors.text)}
            />
            {errors.text && <p className="text-xs text-destructive">{errors.text}</p>}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="change-evidence">Evidence</Label>
              <NativeSelect
                id="change-evidence"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value as Evidence)}
              >
                {EVIDENCE.map((ev) => (
                  <option key={ev} value={ev}>
                    {EVIDENCE_LABELS[ev]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {kind === "add" && (
              <div className="space-y-1.5">
                <Label htmlFor="change-type">Type</Label>
                <NativeSelect
                  id="change-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  <option value="functional">Functional</option>
                  <option value="non_functional">Non-functional</option>
                </NativeSelect>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="change-reason">Why</Label>
        <Textarea
          id="change-reason"
          rows={2}
          value={reason}
          maxLength={500}
          placeholder="Who asked for it and why — it's kept with the requirement's history."
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={Boolean(errors.reason)}
        />
        {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={action.busy || (kind !== "add" && !code)}>
          {action.busy ? "Analysing the impact…" : "Analyse impact"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Nothing changes until you approve the change.
        </span>
      </div>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error === "Some fields are invalid"
            ? "Check the highlighted fields."
            : action.error}
        </p>
      )}
    </form>
  );
}
