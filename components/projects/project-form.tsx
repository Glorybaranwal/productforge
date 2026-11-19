"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError, apiRequest, toFieldErrors, type FieldErrors } from "@/src/lib/api-client";
import {
  DOMAIN_SUGGESTIONS,
  formatSprintLength,
  ProjectInput,
  SPRINT_LENGTHS,
  type Project,
} from "@/src/modules/projects/schema";

type Field = "name" | "domain" | "audience" | "teamSize" | "sprintLengthDays";
type Values = Record<Field, string>;

function toValues(project?: Project): Values {
  return {
    name: project?.name ?? "",
    domain: project?.domain ?? "",
    audience: project?.audience ?? "",
    teamSize: project ? String(project.teamSize) : "5",
    sprintLengthDays: project ? String(project.sprintLengthDays) : "14",
  };
}

function without(errors: FieldErrors, field: string): FieldErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

type ProjectFormProps = { mode: "create" | "edit"; project?: Project };

export function ProjectForm({ mode, project }: ProjectFormProps) {
  const router = useRouter();
  const formId = useId();
  const [values, setValues] = useState<Values>(() => toValues(project));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  const change = (field: Field) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => without(current, field));
    if (status === "saved") setStatus("idle");
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = ProjectInput.safeParse(values);
    if (!parsed.success) {
      setErrors(
        toFieldErrors(
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
      return;
    }

    setErrors({});
    setStatus("saving");
    try {
      if (mode === "create") {
        const { project: created } = await apiRequest<{ project: Project }>("/api/projects", {
          method: "POST",
          body: parsed.data,
        });
        // A push already fetches the new page; a refresh on top would render it twice (ADR-023).
        router.push(`/dashboard/projects/${created.id}`);
      } else if (project) {
        await apiRequest(`/api/projects/${project.id}`, { method: "PATCH", body: parsed.data });
        setStatus("saved");
        router.refresh();
      }
    } catch (err) {
      setStatus("idle");
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  }

  const fieldProps = (field: Field) => ({
    id: `${formId}-${field}`,
    name: field,
    value: values[field],
    onChange: change(field),
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${formId}-${field}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Project details">
      <FormField id={`${formId}-name`} label="Project name" error={errors.name}>
        <Input {...fieldProps("name")} placeholder="e.g. Transaction monitoring dashboard" />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={`${formId}-domain`} label="Domain" error={errors.domain}>
          <Input {...fieldProps("domain")} list={`${formId}-domains`} placeholder="e.g. Fintech" />
          <datalist id={`${formId}-domains`}>
            {DOMAIN_SUGGESTIONS.map((domain) => (
              <option key={domain} value={domain} />
            ))}
          </datalist>
        </FormField>
        <FormField id={`${formId}-audience`} label="Audience" error={errors.audience}>
          <Input {...fieldProps("audience")} placeholder="e.g. Retail banking customers" />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id={`${formId}-teamSize`} label="Team size" error={errors.teamSize}>
          <Input {...fieldProps("teamSize")} type="number" inputMode="numeric" min={1} max={100} />
        </FormField>
        <FormField
          id={`${formId}-sprintLengthDays`}
          label="Sprint length"
          error={errors.sprintLengthDays}
        >
          <NativeSelect {...fieldProps("sprintLengthDays")}>
            {SPRINT_LENGTHS.map((days) => (
              <option key={days} value={days}>
                {formatSprintLength(days)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : mode === "create" ? "Create project" : "Save changes"}
        </Button>
        {mode === "create" && (
          <Button asChild variant="ghost">
            <Link href="/dashboard">Cancel</Link>
          </Button>
        )}
        {status === "saved" && (
          <p role="status" className="text-sm text-muted-foreground">
            Saved
          </p>
        )}
      </div>
    </form>
  );
}

function FormField(props: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.error && (
        <p id={`${props.id}-error`} className="text-sm text-destructive">
          {props.error}
        </p>
      )}
    </div>
  );
}
