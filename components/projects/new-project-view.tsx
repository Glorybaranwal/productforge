import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { ProjectForm } from "./project-form";

export function NewProjectView() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
        ← All projects
      </Link>
      <Card>
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">New project</h1>
          <CardDescription>
            These details give the AI context about who you&apos;re building for. You can change
            them later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}

export function ProjectNotFoundView() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-14 text-center">
      <h1 className="text-lg font-semibold">Project not found</h1>
      <p className="text-sm text-muted-foreground">
        It may have been deleted, or it belongs to another workspace.
      </p>
      <Link href="/dashboard" className="text-sm font-medium underline underline-offset-4">
        Back to projects
      </Link>
    </div>
  );
}
