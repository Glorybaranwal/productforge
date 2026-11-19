"use client";

import { z } from "zod";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { criterionFlags } from "@/src/ai/orchestrator/rules";
import { apiRequest } from "@/src/lib/api-client";
import { newId } from "@/src/lib/ids";
import {
  CRITERION_KIND_LABELS,
  CRITERION_KINDS,
  CriterionRow,
  type CriterionKind,
} from "@/src/modules/stories/schema";
import type { StoryView } from "@/src/modules/stories/state";

import { EditorSection } from "./editor-section";
import { useAutosave } from "./use-autosave";

type Row = { id: string; kind: CriterionKind; given: string; when: string; then: string };

const Rows = z.array(CriterionRow);

/** Given/When/Then criteria of a draft story (autosaved), with wording flags. */
export function CriteriaEditor({ story }: { story: StoryView }) {
  const { draft, change, status, message } = useAutosave<Row[]>(
    story.criteria.map(({ id, kind, given, when, then }) => ({ id, kind, given, when, then })),
    (rows) => {
      const parsed = Rows.safeParse(rows);
      if (parsed.success) return { ok: true, value: parsed.data };
      const issue = parsed.error.issues[0];
      const n = typeof issue?.path[0] === "number" ? issue.path[0] + 1 : null;
      return {
        ok: false,
        message: `${n ? `Criterion ${n}: ` : ""}${issue?.message ?? "Check the criteria"}`,
      };
    },
    (value) =>
      apiRequest(`/api/stories/${story.id}`, {
        method: "PATCH",
        body: { section: "criteria", value },
      }),
  );
  const update = (i: number, patch: Partial<Row>) =>
    change(draft.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const field = "min-h-10 text-sm";

  return (
    <EditorSection
      title="Acceptance criteria"
      status={status}
      message={message}
      hint="At least 2 per story, including a negative or edge case. Use numbers instead of words like “fast”."
    >
      <ol className="space-y-3">
        {draft.map((row, i) => {
          const flags = criterionFlags(row);
          const n = i + 1;
          return (
            <li key={row.id} className="space-y-2 rounded-lg border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <NativeSelect
                  aria-label={`Criterion ${n} type`}
                  className="h-8 w-36 py-0 text-xs"
                  value={row.kind}
                  onChange={(e) => update(i, { kind: e.target.value as CriterionKind })}
                >
                  {CRITERION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CRITERION_KIND_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove criterion ${n}`}
                  onClick={() => change(draft.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {(["given", "when", "then"] as const).map((part) => (
                  <label key={part} className="space-y-1 text-xs font-medium text-muted-foreground">
                    <span className="capitalize">{part}</span>
                    <Textarea
                      aria-label={`Criterion ${n} ${part}`}
                      rows={2}
                      className={field}
                      value={row[part]}
                      onChange={(e) => update(i, { [part]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              {flags.length > 0 && (
                <ul
                  className="space-y-0.5 text-xs text-amber-800"
                  aria-label={`Criterion ${n} wording problems`}
                >
                  {flags.map((f) => (
                    <li key={f}>⚠ {f}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          change([...draft, { id: newId(), kind: "edge", given: "", when: "", then: "" }])
        }
      >
        Add criterion
      </Button>
    </EditorSection>
  );
}
