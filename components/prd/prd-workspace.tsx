"use client";

import Link from "next/link";
import { useState } from "react";

import { PrdReviewBanner } from "@/components/impact/review-flags";
import { Badge } from "@/components/ui/badge";
import { PRD_SECTIONS } from "@/src/modules/prd/schema";
import type { PrdState } from "@/src/modules/prd/service";
import type { Project } from "@/src/modules/projects/schema";

import { CompareView } from "./compare-view";
import { GatePanel } from "./gate-panel";
import { SectionCard } from "./section-card";
import { Toolbar } from "./toolbar";
import { TraceabilityPanel } from "./traceability-panel";

type Props = { project: Project; state: PrdState; canManage: boolean };

export function PrdWorkspace({ project, state, canManage }: Props) {
  const { versions, gate1Passed } = state;
  const latest = versions.at(-1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "compare">("edit");
  const selected = versions.find((v) => v.id === selectedId) ?? latest;
  const editable = Boolean(selected && selected.id === latest?.id && selected.status === "DRAFT");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {project.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Product requirements</h1>
          {selected && (
            <Badge variant={selected.status === "APPROVED" ? "default" : "secondary"}>
              Version {selected.version} · {selected.status === "APPROVED" ? "Approved" : "Draft"}
              {selected.origin === "ai_edited" ? " · AI-edited" : ""}
            </Badge>
          )}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Generated from the requirements approved at Gate 1. Every requirement links back to its
          code. Approve to freeze a version (Gate 2).
        </p>
      </div>

      <PrdReviewBanner
        flags={state.review}
        projectId={project.id}
        canManage={canManage}
        approvedVersion={
          [...versions].reverse().find((v) => v.status === "APPROVED")?.version ?? null
        }
        latestVersion={latest?.version ?? null}
      />
      {!gate1Passed ? (
        <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          Confirm the requirements first.{" "}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href={`/dashboard/projects/${project.id}/discovery`}
          >
            Go to discovery (Gate 1)
          </Link>
        </div>
      ) : (
        <>
          <Toolbar
            project={project}
            state={state}
            selected={selected}
            onSelect={setSelectedId}
            mode={mode}
            onMode={setMode}
            canManage={canManage}
          />
          {selected && mode === "compare" && versions.length > 1 ? (
            <CompareView versions={versions} />
          ) : selected ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4" key={selected.id}>
                {!editable && (
                  <p className="rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                    {selected.status === "APPROVED"
                      ? `Version ${selected.version} is approved and frozen.`
                      : "Older draft."}{" "}
                    {selected.id !== latest?.id
                      ? "Viewing an earlier version."
                      : "Start a new version to make changes."}
                  </p>
                )}
                {PRD_SECTIONS.map((section) => (
                  <SectionCard
                    key={section.key}
                    prdId={selected.id}
                    section={section}
                    value={selected.content[section.key]}
                    readOnly={!editable}
                    requirements={state.requirements}
                  />
                ))}
              </div>
              <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <GatePanel state={state} latest={latest!} canManage={canManage} />
                <TraceabilityPanel state={state} prd={selected} />
              </aside>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
              Requirements are confirmed. Generate the PRD to start.
            </div>
          )}
        </>
      )}
    </div>
  );
}
