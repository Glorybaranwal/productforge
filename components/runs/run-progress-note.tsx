/** The latest step of a running AI stage, under its button (PF-027). */
export function RunProgressNote({ busy, message }: { busy: boolean; message: string | null }) {
  if (!busy || !message) return null;
  return (
    <p aria-live="polite" data-testid="run-progress" className="text-muted-foreground">
      {message}
    </p>
  );
}
