"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/src/lib/utils";
import type { Project } from "@/src/modules/projects/schema";
import type { Requirement } from "@/src/modules/requirements/schema";
import type { Traceability, TraceStatus } from "@/src/modules/traceability/schema";

import { GapList } from "./gap-list";
import { RequirementMatrix, StoryMatrix } from "./matrix-tables";

type View = "requirements" | "stories";
type StatusFilter = "all" | "attention" | "in_review" | "traced" | "waiting";

const FILTERS: Record<StatusFilter, { label: string; test: (s: TraceStatus) => boolean }> = {
  all: { label: "All statuses", test: () => true },
  attention: {
    label: "Needs attention",
    test: (s) => s === "gap" || s === "rejected_only" || s === "incomplete",
  },
  in_review: { label: "In review", test: (s) => s === "in_review" },
  traced: { label: "Traced", test: (s) => s === "traced" },
  waiting: { label: "Waiting on an answer", test: (s) => s === "waiting" },
};

export function TraceabilityView({ project, trace }: { project: Project; trace: Traceability }) {
  const [view, setView] = useState<View>("requirements");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<"all" | Requirement["type"]>("all");
  const [query, setQuery] = useState("");
  const base = `/dashboard/projects/${project.id}`;
  const q = query.trim().toLowerCase();
  // Codes match from the start ("FR-02" isn't "NFR-02"); text matches anywhere.
  const code = (c: string) => c.toLowerCase().startsWith(q);
  const rows = trace.requirements.filter(
    (r) =>
      FILTERS[status].test(r.status) &&
      (type === "all" || r.type === type) &&
      (!q ||
        code(r.code) ||
        r.text.toLowerCase().includes(q) ||
        r.stories.some((s) => code(s.code))),
  );
  const stories = trace.stories.filter(
    (s) => !q || code(s.code) || s.title.toLowerCase().includes(q) || s.requirementCodes.some(code),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={base} className="text-sm text-muted-foreground hover:text-foreground">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Traceability</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every approved requirement, followed through the approved PRD to its stories, acceptance
          criteria, tasks and approval.
        </p>
      </div>

      {!trace.gate1Passed ? (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Nothing to trace yet — confirm the requirements first.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`${base}/discovery`}
          >
            Go to discovery (Gate 1)
          </Link>
        </div>
      ) : (
        <>
          <ScoreCards trace={trace} />
          <GapList gaps={trace.gaps} />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Matrix view"
                className="inline-flex rounded-lg border bg-card p-0.5"
              >
                {(["requirements", "stories"] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    type="button"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm",
                      view === v
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v === "requirements"
                      ? `By requirement (${trace.requirements.length})`
                      : `By story (${trace.stories.length})`}
                  </button>
                ))}
              </div>
              <Input
                aria-label="Search codes and text"
                placeholder="Search FR-01, US-003, text…"
                className="h-9 w-56 max-w-full"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {view === "requirements" && (
                <>
                  <NativeSelect
                    aria-label="Status"
                    className="h-9 w-48"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  >
                    {Object.entries(FILTERS).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label="Type"
                    className="h-9 w-40"
                    value={type}
                    onChange={(e) => setType(e.target.value as typeof type)}
                  >
                    <option value="all">All types</option>
                    <option value="functional">Functional</option>
                    <option value="non_functional">Non-functional</option>
                  </NativeSelect>
                </>
              )}
              <CsvActions projectId={project.id} />
            </div>
            <p className="text-xs text-muted-foreground" role="status">
              {view === "requirements"
                ? `Showing ${rows.length} of ${trace.requirements.length} requirements`
                : `Showing ${stories.length} of ${trace.stories.length} stories`}
            </p>
            {view === "requirements" ? (
              <RequirementMatrix rows={rows} backlogHref={`${base}/backlog`} />
            ) : trace.stories.length ? (
              <StoryMatrix
                rows={stories}
                requirements={trace.requirements}
                backlogHref={`${base}/backlog`}
                prdVersion={trace.prdVersion}
              />
            ) : (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No stories yet.{" "}
                <Link
                  className="font-medium text-foreground underline underline-offset-4"
                  href={`${base}/backlog`}
                >
                  Generate the backlog
                </Link>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScoreCards({ trace }: { trace: Traceability }) {
  const c = trace.coverage;
  const bars: [string, number][] = [
    ["In the approved PRD", c.inPrd],
    ["Has a story", c.withStory],
    ["Has testable criteria", c.testable],
    ["Has estimated tasks", c.estimated],
    ["Has an approved story", c.approved],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <section aria-label="Traceability score" className="space-y-1 rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">Traceability score</p>
        <p className="text-4xl font-semibold tracking-tight">{trace.score ?? 0}%</p>
        <p className="text-xs text-muted-foreground">
          Average share of the 5 links each requirement needs.{" "}
          {c.waiting ? `${c.waiting} open question${c.waiting === 1 ? "" : "s"} not counted.` : ""}
        </p>
        {trace.approvedStoriesTraced !== null && (
          <p className="pt-1 text-xs">
            Approved stories linked only to approved requirements:{" "}
            <b>{trace.approvedStoriesTraced}%</b>
          </p>
        )}
      </section>
      <section
        aria-label="Coverage by link"
        className="grid gap-x-6 gap-y-2 rounded-xl border bg-card p-5 sm:grid-cols-2"
      >
        {bars.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <p className="flex justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span>
                <b>{value}</b> / {c.required}
              </span>
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full bg-primary"
                style={{ width: `${c.required ? (value / c.required) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
        <p className="self-end text-xs text-muted-foreground">
          {trace.totals.stories} stories · {trace.totals.criteria} criteria · {trace.totals.tasks}{" "}
          tasks · {trace.totals.hours} h
        </p>
      </section>
    </div>
  );
}

/** CSV for auditors: fetched from the API (so the export is audit-logged), then copied or downloaded. */
function CsvActions({ projectId }: { projectId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  async function fetchCsv(): Promise<string | null> {
    const res = await fetch(`/api/projects/${projectId}/traceability/csv`).catch(() => null);
    if (!res?.ok) {
      setMessage("Couldn't export the matrix. Try again.");
      return null;
    }
    return res.text();
  }
  async function copy() {
    const csv = await fetchCsv();
    if (csv === null) return;
    try {
      await navigator.clipboard.writeText(csv);
      setManual(null);
      setMessage("Copied the matrix as CSV — paste it into a spreadsheet");
    } catch {
      setManual(csv);
      setMessage("The browser blocked copying — select the text below and copy it.");
    }
  }
  async function download() {
    const csv = await fetchCsv();
    if (csv === null) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "traceability.csv",
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Downloaded traceability.csv");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={copy}>
        Copy as CSV
      </Button>
      <Button variant="outline" size="sm" onClick={download}>
        Download CSV
      </Button>
      {message && (
        <span role="status" className="w-full text-xs text-muted-foreground">
          {message}
        </span>
      )}
      {manual && (
        <textarea
          readOnly
          aria-label="Matrix as CSV"
          value={manual}
          rows={6}
          className="w-full rounded-md border bg-background p-2 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
