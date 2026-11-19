"use client";

import { EvidenceBadge } from "@/components/discovery/badges";
import { ReviewFlags } from "@/components/impact/review-flags";
import { CodeChip } from "@/components/prd/section-editors";
import { cn } from "@/src/lib/utils";
import type { Requirement } from "@/src/modules/requirements/schema";
import { storySentence, type Epic } from "@/src/modules/stories/schema";
import type { StoryView } from "@/src/modules/stories/state";

import { CriteriaEditor } from "./criteria-editor";
import { KindBadge, PriorityBadge, StoryChip, StoryStatusBadge } from "./editor-section";
import { StoryActions } from "./story-actions";
import { StoryFieldsEditor } from "./story-fields-editor";
import { TasksEditor } from "./tasks-editor";

type Props = {
  story: StoryView;
  open: boolean;
  onToggle: () => void;
  epics: Epic[];
  requirements: Requirement[];
  stories: StoryView[];
  canManage: boolean;
};

/**
 * Editors keep what people type locally, so they remount only when the AI rewrites the rows (a
 * new run id), never while someone is typing.
 */
const runKey = (rows: { agentRunId: string | null }[]) =>
  [...new Set(rows.map((r) => r.agentRunId).filter(Boolean))].join(",");

const ORIGIN_LABEL = { ai: "AI draft", ai_edited: "AI-edited", human: "Written by hand" } as const;

/** One story: a summary row that expands into its editor (drafts) or read-only view. */
export function StoryCard({
  story,
  open,
  onToggle,
  epics,
  requirements,
  stories,
  canManage,
}: Props) {
  const byCode = new Map(requirements.map((r) => [r.code, r]));
  const panel = `story-panel-${story.code}`;
  const state =
    story.status === "DRAFT"
      ? story.blockers.length
        ? `${story.blockers.length} to fix`
        : "Ready"
      : null;

  return (
    <article
      id={`story-${story.code}`}
      aria-label={story.code}
      className={cn("rounded-xl border bg-card", story.status === "REJECTED" && "opacity-70")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="font-mono text-xs text-muted-foreground">{story.code}</span>
        <span
          className={cn(
            "min-w-0 flex-1 text-sm font-medium",
            story.status === "REJECTED" && "line-through",
          )}
        >
          {story.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={story.priority} />
          <span className="text-xs text-muted-foreground">
            {story.storyPoints ? `${story.storyPoints} pts` : "– pts"}
          </span>
          <StoryStatusBadge status={story.status} />
          {story.review.length > 0 && (
            <span className="text-xs font-medium text-sky-800">Needs review</span>
          )}
          {state && (
            <span
              className={cn(
                "text-xs",
                story.blockers.length ? "text-destructive" : "text-emerald-700",
              )}
            >
              {state}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div id={panel} className="space-y-5 border-t px-4 py-4">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <EvidenceBadge evidence={story.evidence} />
            <span>
              v{story.version}
              {story.versions > 1 ? ` of ${story.versions}` : ""} · {ORIGIN_LABEL[story.origin]}
              {story.prdVersion ? ` · from PRD v${story.prdVersion}` : ""}
            </span>
          </div>
          {story.rationale && (
            <p className="text-xs text-muted-foreground">Why: {story.rationale}</p>
          )}
          <ReviewFlags
            flags={story.review}
            refId={story.code}
            projectId={story.projectId}
            canManage={canManage}
            hint={
              story.status === "APPROVED"
                ? `Use "Edit as version ${story.version + 1}" to update it, or mark it reviewed if nothing needs to change.`
                : "Edit the draft, then mark it reviewed — it can't be approved until then."
            }
          />

          {story.status === "DRAFT" ? (
            <>
              <StoryFieldsEditor
                key={`story:${story.id}:${story.agentRunId}:${runKey(story.tasks)}`}
                story={story}
                epics={epics}
                requirements={requirements}
                stories={stories}
              />
              <CriteriaEditor
                key={`criteria:${story.id}:${runKey(story.criteria)}`}
                story={story}
              />
              <TasksEditor key={`tasks:${story.id}:${runKey(story.tasks)}`} story={story} />
            </>
          ) : (
            <ReadOnlyStory story={story} byCode={byCode} />
          )}
          <StoryActions story={story} canManage={canManage} />
        </div>
      )}
    </article>
  );
}

function ReadOnlyStory({ story, byCode }: { story: StoryView; byCode: Map<string, Requirement> }) {
  return (
    <div className="space-y-4 text-sm">
      <p>{storySentence(story)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Requirements</span>
        {story.requirementCodes.map((c) => (
          <CodeChip key={c} code={c} requirement={byCode.get(c)} />
        ))}
        {story.dependsOn.length > 0 && (
          <span className="ml-2 text-xs font-medium text-muted-foreground">Depends on</span>
        )}
        {story.dependsOn.map((c) => (
          <StoryChip key={c} code={c} />
        ))}
      </div>
      <section aria-label="Acceptance criteria" className="space-y-2">
        <h3 className="text-sm font-semibold">Acceptance criteria</h3>
        <ol className="space-y-1.5">
          {story.criteria.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-2">
              <KindBadge kind={c.kind} />
              <span>
                <b>Given</b> {c.given}, <b>when</b> {c.when}, <b>then</b> {c.then}.
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Tasks" className="space-y-2">
        <h3 className="text-sm font-semibold">Tasks · {story.totalHours} h</h3>
        <ul className="space-y-1">
          {story.tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap gap-x-2">
              <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
              <span>{t.title}</span>
              <span className="text-muted-foreground">· {t.estimateHours} h</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
