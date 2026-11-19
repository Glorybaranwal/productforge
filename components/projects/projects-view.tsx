import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, plural } from "@/src/lib/format";
import { formatSprintCadence, type Project } from "@/src/modules/projects/schema";

export function ProjectsView({ projects }: { projects: Project[] }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project turns an idea into a reviewed, traceable backlog.
          </p>
        </div>
        {projects.length > 0 && (
          <Button asChild>
            <Link href="/dashboard/projects/new">New project</Link>
          </Button>
        )}
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul aria-label="Projects" className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className="flex h-full flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm transition-colors outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="leading-snug font-semibold">{project.name}</h2>
        <Badge variant="secondary">{project.domain}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{project.audience}</p>
      <p className="mt-auto text-xs text-muted-foreground">
        {plural(project.teamSize, "person", "people")} ·{" "}
        {formatSprintCadence(project.sprintLengthDays)} · Updated {formatDate(project.updatedAt)}
      </p>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-background px-6 py-14 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">No projects yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create a project for your idea. Next you&apos;ll paste notes or documents and ProductForge
          will turn them into requirements, a PRD and a backlog.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard/projects/new">Create your first project</Link>
      </Button>
    </div>
  );
}
