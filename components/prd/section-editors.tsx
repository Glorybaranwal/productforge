"use client";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import type { TracedItem } from "@/src/modules/prd/schema";
import { EVIDENCE_LABELS, type Requirement } from "@/src/modules/requirements/schema";

type Editor<T> = { value: T; onChange: (value: T) => void; readOnly: boolean; label: string };

export function TextEditor({ value, onChange, readOnly, label }: Editor<string>) {
  if (readOnly) return <p className="text-sm whitespace-pre-line">{value}</p>;
  return (
    <Textarea
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
    />
  );
}

/** One item per line. */
export function ListEditor({ value, onChange, readOnly, label }: Editor<string[]>) {
  if (readOnly) return <Bullets items={value} />;
  return (
    <Textarea
      aria-label={label}
      value={value.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n"))}
      onBlur={() => onChange(value.map((v) => v.trim()).filter(Boolean))}
      rows={Math.max(3, value.length + 1)}
    />
  );
}

type Field<T> = { key: keyof T & string; label: string; placeholder: string };

/** Goals, personas, risks: rows of two fields with add / remove. */
export function RowsEditor<T extends Record<string, string>>({
  value,
  onChange,
  readOnly,
  label,
  fields,
  empty,
}: Editor<T[]> & { fields: [Field<T>, Field<T>]; empty: T }) {
  if (readOnly) {
    return (
      <Bullets
        items={value.map(
          (row) =>
            `${row[fields[0].key]} — ${fields[1].label.toLowerCase()}: ${row[fields[1].key]}`,
        )}
      />
    );
  }
  const set = (index: number, key: string, v: string) =>
    onChange(value.map((row, i) => (i === index ? { ...row, [key]: v } : row)));
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      {value.map((row, index) => (
        <div key={index} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
          {fields.map((f) => (
            <Textarea
              key={f.key}
              aria-label={`${f.label} ${index + 1}`}
              placeholder={f.placeholder}
              value={row[f.key]}
              rows={2}
              className="min-h-10"
              onChange={(e) => set(index, f.key, e.target.value)}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${fields[0].label.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { ...empty }])}
      >
        Add {fields[0].label.toLowerCase()}
      </Button>
    </div>
  );
}

const CHIP_STYLE: Record<string, string> = {
  EXPLICIT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  INFERRED: "border-sky-200 bg-sky-50 text-sky-800",
  ASSUMPTION: "border-amber-200 bg-amber-50 text-amber-900",
  OPEN_QUESTION: "border-violet-200 bg-violet-50 text-violet-800",
};

export function CodeChip({
  code,
  requirement,
  onRemove,
}: {
  code: string;
  requirement?: Pick<Requirement, "evidence" | "text">;
  onRemove?: () => void;
}) {
  const style = requirement
    ? CHIP_STYLE[requirement.evidence]
    : "border-destructive/40 bg-destructive/10 text-destructive";
  const title = requirement
    ? `${EVIDENCE_LABELS[requirement.evidence]}: ${requirement.text}`
    : "Unknown requirement code";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs",
        style,
      )}
      title={title}
    >
      {code}
      {onRemove && (
        <button
          type="button"
          aria-label={`Unlink ${code}`}
          className="leading-none opacity-70 hover:opacity-100"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Functional/non-functional items, assumptions and open questions: text plus linked requirement codes. */
export function TracedEditor({
  value,
  onChange,
  readOnly,
  label,
  requirements,
  requireLink,
}: Editor<TracedItem[]> & { requirements: Requirement[]; requireLink: boolean }) {
  const byCode = new Map(requirements.map((r) => [r.code, r]));
  const set = (index: number, patch: Partial<TracedItem>) =>
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <ul className="space-y-3" aria-label={label}>
      {value.map((item, index) => (
        <li key={index} className="space-y-2 rounded-lg border p-3">
          {readOnly ? (
            <p className="text-sm">{item.text}</p>
          ) : (
            <Textarea
              aria-label={`${label} item ${index + 1}`}
              value={item.text}
              rows={2}
              onChange={(e) => set(index, { text: e.target.value })}
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {item.requirementCodes.map((code) => (
              <CodeChip
                key={code}
                code={code}
                requirement={byCode.get(code)}
                onRemove={
                  readOnly
                    ? undefined
                    : () =>
                        set(index, {
                          requirementCodes: item.requirementCodes.filter((c) => c !== code),
                        })
                }
              />
            ))}
            {item.requirementCodes.length === 0 && requireLink && (
              <span className="text-xs text-destructive">Link at least one requirement</span>
            )}
            {!readOnly && (
              <>
                <NativeSelect
                  aria-label={`Link a requirement to ${label} item ${index + 1}`}
                  className="h-7 w-44 max-w-full py-0 text-xs"
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    set(index, { requirementCodes: [...item.requirementCodes, e.target.value] })
                  }
                >
                  <option value="">+ Link requirement</option>
                  {requirements
                    .filter((r) => !item.requirementCodes.includes(r.code))
                    .map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.code} — {r.text.slice(0, 60)}
                      </option>
                    ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7"
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        </li>
      ))}
      {!readOnly && (
        <li>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...value, { text: "", requirementCodes: [] }])}
          >
            Add item
          </Button>
        </li>
      )}
      {readOnly && value.length === 0 && <li className="text-sm text-muted-foreground">None.</li>}
    </ul>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
