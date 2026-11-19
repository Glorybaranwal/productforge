import Link from "next/link";

import { Button } from "@/components/ui/button";

const PIPELINE = ["Idea", "PRD", "Epics", "Stories", "Acceptance criteria", "Tasks"] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground">Early development</p>
        <h1 className="text-4xl font-semibold tracking-tight">ProductForge AI</h1>
        <p className="text-lg text-muted-foreground">
          From idea to sprint-ready backlog in minutes — with every AI output reviewed by a human
          and traceable to its source.
        </p>
      </div>

      <ol aria-label="Pipeline" className="flex flex-wrap items-center gap-2 text-sm">
        {PIPELINE.map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            {/* Arrow leads its step, so a wrapped line never ends on a dangling arrow */}
            {index > 0 && (
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            )}
            <span className="rounded-md border bg-secondary px-2.5 py-1 text-secondary-foreground">
              {step}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <Button asChild size="lg">
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
