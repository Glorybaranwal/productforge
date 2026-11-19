/**
 * Shown the moment a dashboard link is clicked, while the server renders the page (ADR-023): the
 * click responds at once instead of the old page sitting still.
 */
export function PageSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className="h-7 w-1/3 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border bg-background" />
        ))}
      </div>
    </div>
  );
}
