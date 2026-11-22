/**
 * The latest step of a running AI stage, under its button (PF-027). The live region is always in
 * the page and only its text changes: screen readers announce changes to a region that was already
 * there, not one that appears already filled.
 */
export function RunProgressNote({ busy, message }: { busy: boolean; message: string | null }) {
  return (
    <p role="status" data-testid="run-progress" className="text-muted-foreground">
      {busy && message ? message : ""}
    </p>
  );
}
