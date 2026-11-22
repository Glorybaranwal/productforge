"use client";

import type { Prd } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";

export function TraceabilityPanel({ state, prd }: { state: PrdState; prd: Prd }) {
  const content = prd.content;
  const linked = new Set(
    [
      ...content.functionalRequirements,
      ...content.nonFunctionalRequirements,
      ...content.assumptions,
      ...content.openQuestions,
    ].flatMap((i) => i.requirementCodes),
  );
  const covered = state.requirements.filter((r) => linked.has(r.code)).length;
  const total = state.requirements.length;
  return (
    <section aria-label="Traceability" className="space-y-2 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Traceability</h2>
      <p className="text-sm">
        <span className="text-2xl font-semibold">{covered}</span>
        <span className="text-muted-foreground"> / {total} approved requirements covered</span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full bg-primary"
          style={{ width: `${total ? Math.round((covered / total) * 100) : 0}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Chip colours show each requirement&apos;s evidence: explicit, inferred, assumption, open
        question.
      </p>
    </section>
  );
}
