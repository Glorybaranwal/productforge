import Link from "next/link";

import { EvidenceBadge, TypeBadge } from "@/components/discovery/badges";
import { CodeChip } from "@/components/prd/section-editors";
import { StoryStatusBadge } from "@/components/backlog/editor-section";
import type { RequirementTrace, StoryTrace } from "@/src/modules/traceability/schema";

import { CriteriaCounts, StoryLink, TraceChain, TraceStatusBadge } from "./trace-bits";

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-3 align-top";

/** One row per requirement: where it shows up in the PRD, which stories carry it, and how far it got. */
export function RequirementMatrix({
  rows,
  backlogHref,
}: {
  rows: RequirementTrace[];
  backlogHref: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[760px] text-sm" aria-label="Traceability by requirement">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={th}>Requirement · PRD section</th>
            <th className={th}>Stories</th>
            <th className={th}>Criteria +/−/edge</th>
            <th className={th}>Tasks</th>
            <th className={th}>Trace</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const hours = r.stories.reduce((n, s) => n + s.hours, 0);
            const tasks = r.stories.reduce((n, s) => n + s.tasks, 0);
            return (
              <tr key={r.code} aria-label={r.code}>
                <td className={`${td} max-w-sm`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-medium">{r.code}</span>
                    <TypeBadge type={r.type} />
                    <EvidenceBadge evidence={r.evidence} />
                  </div>
                  <p className="mt-1 text-muted-foreground">{r.text}</p>
                  <p className="mt-1 text-xs">
                    {r.prdSections.length ? (
                      <span className="text-muted-foreground">PRD: {r.prdSections.join(", ")}</span>
                    ) : (
                      <span className="text-destructive">Not in the approved PRD</span>
                    )}
                  </p>
                </td>
                <td className={td}>
                  <div className="flex flex-col gap-1">
                    {r.stories.map((s) => (
                      <StoryLink key={s.code} story={s} backlogHref={backlogHref} />
                    ))}
                    {r.rejected.map((s) => (
                      <StoryLink key={s.code} story={s} backlogHref={backlogHref} />
                    ))}
                    {!r.stories.length && !r.rejected.length && (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </div>
                </td>
                <td className={td}>
                  <CriteriaCounts stories={r.stories} />
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {tasks ? (
                    `${tasks} · ${hours} h`
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
                <td className={td}>
                  {r.score === null ? (
                    <span className="text-xs text-muted-foreground">n/a</span>
                  ) : (
                    <TraceChain steps={r.steps} label={r.code} />
                  )}
                </td>
                <td className={td}>
                  <TraceStatusBadge status={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One row per story: the requirements it implements, its checks and tasks, and staleness. */
export function StoryMatrix({
  rows,
  requirements,
  backlogHref,
  prdVersion,
}: {
  rows: StoryTrace[];
  requirements: RequirementTrace[];
  backlogHref: string;
  prdVersion: number | null;
}) {
  const byCode = new Map(requirements.map((r) => [r.code, r]));
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[760px] text-sm" aria-label="Traceability by story">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={th}>Story</th>
            <th className={th}>Epic</th>
            <th className={th}>Requirements</th>
            <th className={th}>Criteria +/−/edge</th>
            <th className={th}>Tasks</th>
            <th className={th}>From PRD</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((s) => (
            <tr key={s.code} aria-label={s.code}>
              <td className={`${td} max-w-xs`}>
                <Link
                  href={`${backlogHref}?story=${s.code}`}
                  className="font-mono text-xs font-medium whitespace-nowrap underline-offset-4 hover:underline"
                >
                  {s.code}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">v{s.version}</span>
                <p className="mt-1">{s.title}</p>
              </td>
              <td className={`${td} text-xs text-muted-foreground`}>
                {s.epicCode} · {s.epicTitle}
              </td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  {s.requirementCodes.map((c) => (
                    <CodeChip key={c} code={c} requirement={byCode.get(c)} />
                  ))}
                </div>
                {s.unknownCodes.length > 0 && (
                  <p className="mt-1 text-xs text-destructive">
                    Not approved: {s.unknownCodes.join(", ")}
                  </p>
                )}
              </td>
              <td className={td}>
                <CriteriaCounts stories={[s]} />
              </td>
              <td className={`${td} whitespace-nowrap`}>
                {s.tasks ? (
                  `${s.tasks} · ${s.hours} h`
                ) : (
                  <span className="text-destructive">None</span>
                )}
              </td>
              <td className={`${td} text-xs`}>
                {s.prdVersion ? `v${s.prdVersion}` : "–"}
                {s.stale && <p className="text-amber-800">PRD v{prdVersion} is newer</p>}
              </td>
              <td className={td}>
                <StoryStatusBadge status={s.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
