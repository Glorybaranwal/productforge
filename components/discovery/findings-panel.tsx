import type { Discovery } from "@/src/modules/requirements/schema";

/** What discovery understood: summary, conflicts, vague terms, actors, goals, constraints. */
export function FindingsPanel({ discovery }: { discovery: Discovery }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="summary-title" className="space-y-2 rounded-xl border bg-card p-5">
        <h2 id="summary-title" className="font-semibold">
          Summary
        </h2>
        <p className="text-sm">{discovery.summary}</p>
        <dl className="grid gap-4 pt-2 text-sm sm:grid-cols-3">
          <Facts title="Actors" items={discovery.actors} />
          <Facts title="Goals" items={discovery.goals} />
          <Facts title="Constraints" items={discovery.constraints} />
        </dl>
      </section>

      <section aria-labelledby="conflicts-title" className="space-y-3">
        <h2 id="conflicts-title" className="font-semibold">
          Conflicts <span className="text-muted-foreground">({discovery.conflicts.length})</span>
        </h2>
        {discovery.conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conflicting statements found.</p>
        ) : (
          <ul aria-label="Conflicts" className="space-y-3">
            {discovery.conflicts.map((c) => (
              <li
                key={c.question}
                className="space-y-2 rounded-xl border border-destructive/30 bg-card p-4"
              >
                <p className="text-sm font-medium">{c.question}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.quotes.map((q) => (
                    <blockquote
                      key={q}
                      className="border-l-2 border-destructive/40 pl-3 text-xs text-muted-foreground"
                    >
                      “{q}”
                    </blockquote>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="vague-title" className="space-y-3">
        <h2 id="vague-title" className="font-semibold">
          Vague terms{" "}
          <span className="text-muted-foreground">({discovery.ambiguities.length})</span>
        </h2>
        {discovery.ambiguities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unmeasurable terms found.</p>
        ) : (
          <ul aria-label="Vague terms" className="grid gap-3 sm:grid-cols-2">
            {discovery.ambiguities.map((a) => (
              <li key={a.term} className="space-y-1 rounded-xl border bg-card p-4 text-sm">
                <p>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-900">
                    {a.term}
                  </span>
                </p>
                <p className="text-muted-foreground">{a.suggestedQuestion}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Facts({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{title}</dt>
      <dd>
        {items.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {items.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
