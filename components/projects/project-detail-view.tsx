import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, plural } from "@/src/lib/format";
import type { AuditLog } from "@/src/modules/audit/schema";
import type { ExportStatus } from "@/src/modules/exports/service";
import type { ImpactStatus } from "@/src/modules/impact/service";
import { formatSprintLength, type Project } from "@/src/modules/projects/schema";
import type { PrdStatus } from "@/src/modules/prd/service";
import type { DiscoveryStatus } from "@/src/modules/requirements/discovery-service";
import type { SprintStatus } from "@/src/modules/sprints/service";
import type { BacklogStatus } from "@/src/modules/stories/service";
import type { TraceabilityStatus } from "@/src/modules/traceability/service";

import { ActivityList } from "./activity-list";
import { DeleteProjectButton } from "./delete-project-button";
import { ProjectForm } from "./project-form";
import {
  prdBadge,
  exportBadge,
  impactBadge,
  sprintBadge,
  traceabilityBadge,
  backlogBadge,
  discoveryBadge,
} from "./stage-badges";

/** The pipeline this project will go through; each stage is delivered by a later module (ADR-011). */
const STAGES = [
  {
    title: "Discovery & clarification",
    description: "Extract requirements with evidence, flag conflicts, answer questions — Gate 1.",
    module: 2,
  },
  {
    title: "PRD",
    description: "Generate, edit, version and approve the product requirements — Gate 2.",
    module: 3,
  },
  {
    title: "Stories, criteria & tasks",
    description: "Epics, user stories, Given/When/Then criteria and estimated tasks — Gate 3.",
    module: 4,
  },
  {
    title: "Traceability",
    description: "Requirement → story → criterion → task matrix with a coverage score.",
    module: 5,
  },
  { title: "Export", description: "Jira-compatible CSV and JSON of approved items.", module: 6 },
  {
    title: "Sprint planning",
    description: "Fit approved stories into sprints by capacity, priority and dependencies.",
    module: 7,
  },
  {
    title: "Change impact",
    description:
      "Change approved requirements safely: see the impact, then review what it touched.",
    module: 8,
  },
] as const;

/** Every module is built (ADR-011); set this to show "Next up" on a future stage. */
const NEXT_MODULE: number | null = null;

type ProjectDetailViewProps = {
  project: Project;
  activity: AuditLog[];
  canDelete: boolean;
  discovery: DiscoveryStatus;
  prd: PrdStatus;
  backlog: BacklogStatus;
  traceability: TraceabilityStatus;
  exports: ExportStatus;
  sprints: SprintStatus;
  impact: ImpactStatus;
};

export function ProjectDetailView({
  project,
  activity,
  canDelete,
  discovery,
  prd,
  backlog,
  traceability,
  exports,
  sprints,
  impact,
}: ProjectDetailViewProps) {
  const live: Record<
    number,
    { href: string; cta: string; badge: ReturnType<typeof discoveryBadge> }
  > = {
    2: {
      href: `/dashboard/projects/${project.id}/discovery`,
      cta: "Open discovery →",
      badge: discoveryBadge(discovery),
    },
    3: { href: `/dashboard/projects/${project.id}/prd`, cta: "Open PRD →", badge: prdBadge(prd) },
    4: {
      href: `/dashboard/projects/${project.id}/backlog`,
      cta: "Open backlog →",
      badge: backlogBadge(backlog),
    },
    5: {
      href: `/dashboard/projects/${project.id}/traceability`,
      cta: "Open traceability →",
      badge: traceabilityBadge(traceability),
    },
    6: {
      href: `/dashboard/projects/${project.id}/export`,
      cta: "Open export →",
      badge: exportBadge(exports),
    },
    7: {
      href: `/dashboard/projects/${project.id}/sprints`,
      cta: "Open sprint plan →",
      badge: sprintBadge(sprints),
    },
    8: {
      href: `/dashboard/projects/${project.id}/changes`,
      cta: "Open change impact →",
      badge: impactBadge(impact),
    },
  };
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← All projects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant="secondary">{project.domain}</Badge>
        </div>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Audience" value={project.audience} />
          <Fact label="Team" value={plural(project.teamSize, "person", "people")} />
          <Fact label="Sprints" value={formatSprintLength(project.sprintLengthDays)} />
          <Fact label="Created" value={formatDate(project.createdAt)} />
        </dl>
      </div>

      <section aria-labelledby="pipeline-heading" className="space-y-3">
        <h2 id="pipeline-heading" className="text-lg font-semibold">
          Pipeline
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => {
            const link = live[stage.module];
            const badge = link
              ? link.badge
              : {
                  label: stage.module === NEXT_MODULE ? "Next up" : `Module ${stage.module}`,
                  variant: "outline" as const,
                };
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Step {index + 1}
                  </span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <h3 className="text-sm font-semibold">{stage.title}</h3>
                <p className="text-xs text-muted-foreground">{stage.description}</p>
              </>
            );
            return (
              <li key={stage.title} className="flex">
                {link ? (
                  <Link
                    href={link.href}
                    className="flex w-full flex-col gap-2 rounded-xl border bg-card p-4 transition-colors outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {body}
                    <span className="mt-auto text-xs font-medium">{link.cta}</span>
                  </Link>
                ) : (
                  <div className="flex w-full flex-col gap-2 rounded-xl border bg-card p-4 opacity-80">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Used as context for every AI step in this project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <ProjectForm mode="edit" project={project} />
            {canDelete && (
              <div className="space-y-3 border-t pt-6">
                <h3 className="text-sm font-semibold">Danger zone</h3>
                <DeleteProjectButton projectId={project.id} projectName={project.name} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Every change is recorded in the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityList entries={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
