import {
  dependencyCycles,
  duplicateCodes,
  messages,
  missingCriteria,
  missingTasks,
  orphanStories,
  oversizedTasks,
  unknownDependencies,
  criterionFlags,
} from "@/src/ai/orchestrator/rules";
import { AppError } from "@/src/lib/errors";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import {
  flagLabel,
  pendingReviews,
  type PendingReviews,
  type ReviewFlag,
} from "@/src/modules/impact/flags";
import { impactRepository } from "@/src/modules/impact/repository";
import { prdRepository } from "@/src/modules/prd/repository";
import type { Prd } from "@/src/modules/prd/schema";
import { getProject } from "@/src/modules/projects/service";
import type { Project } from "@/src/modules/projects/schema";
import { requirementRepository } from "@/src/modules/requirements/repository";
import type { Requirement } from "@/src/modules/requirements/schema";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { backlogRepository, type BacklogRows } from "./repository";
import {
  currentStories,
  type AcceptanceCriterion,
  type Epic,
  type Story,
  type TechnicalTask,
} from "./schema";

export type StoryView = Story & {
  epicCode: string;
  criteria: AcceptanceCriterion[];
  tasks: TechnicalTask[];
  /** Why it can't be approved yet (draft stories only). */
  blockers: string[];
  warnings: string[];
  /** Criterion id → wording problems (vague, untestable). */
  flags: Record<string, string[]>;
  totalHours: number;
  /** How many versions of this code exist. */
  versions: number;
  /** Approved requirement changes this story hasn't been reviewed against (PF-053). */
  review: ReviewFlag[];
};

export type BacklogState = {
  /** Gate 2 passed: an approved PRD exists. */
  gate2Passed: boolean;
  prdVersion: number | null;
  /** Approved requirements: what stories link to. */
  requirements: Requirement[];
  epics: Epic[];
  stories: StoryView[];
  coverage: {
    /** Approved requirements that need a story (open questions wait for an answer). */
    required: string[];
    /** Linked by a draft or approved story. */
    covered: string[];
    /** Linked by an approved story. */
    approvedCovered: string[];
    /** No draft or approved story links them. */
    uncovered: string[];
    /** Open questions: no story until they're answered. */
    waiting: string[];
  };
  counts: { draft: number; approved: number; rejected: number; ready: number; points: number };
  /** What "Generate" would do now. */
  pending: { stories: number; criteria: number; tasks: number };
  gate3: { passed: boolean; blockers: string[] };
  runs: AgentRun[];
  /** Stories flagged "Needs review" and the changes behind them (PF-053). */
  review: { stories: string[]; changes: string[] };
};

export type BacklogContext = {
  project: Project;
  prd: Prd | null;
  approved: Requirement[];
  rows: BacklogRows;
  current: Story[];
  epicCode: Map<string, string>;
  /** Items approved requirement changes flagged and nobody has reviewed yet (PF-053). */
  reviews: PendingReviews;
};

/** Everything the backlog stages and screens need, in one read per collection. */
export async function loadBacklog(
  ctx: WorkspaceContext,
  projectId: string,
): Promise<BacklogContext> {
  const project = await getProject(ctx, projectId);
  const ws = ctx.workspace.id;
  const [versions, requirements, rows, changes] = await Promise.all([
    prdRepository.listByProject(ws, projectId),
    requirementRepository.listByProject(ws, projectId),
    backlogRepository.load(ws, projectId),
    impactRepository.load(ws, projectId),
  ]);
  const prd = [...versions].reverse().find((v) => v.status === "APPROVED") ?? null;
  const current = currentStories(rows.stories);
  return {
    project,
    prd,
    approved: requirements.filter((r) => r.status === "APPROVED"),
    rows,
    current,
    epicCode: new Map(rows.epics.map((e) => [e.id, e.code])),
    reviews: pendingReviews(changes.changes, changes.reviews, current, prd),
  };
}

export function requireGate2(b: BacklogContext): Prd {
  if (!b.prd) throw new AppError("CONFLICT", "Approve the PRD (Gate 2) before generating stories");
  return b.prd;
}

/** Approved requirements that need a story: everything except open questions. */
export const requiredCodes = (approved: Requirement[]) =>
  approved.filter((r) => r.evidence !== "OPEN_QUESTION").map((r) => r.code);

export function linkedBy(stories: Story[]): Set<string> {
  return new Set(stories.flatMap((s) => s.requirementCodes));
}

/** Gate 3 checks for one draft story (errors block approval; warnings don't). */
export function storyChecks(
  story: Story,
  b: Pick<BacklogContext, "approved" | "current" | "reviews">,
  criteria: AcceptanceCriterion[],
  tasks: TechnicalTask[],
): { blockers: string[]; warnings: string[] } {
  const ref = {
    code: story.code,
    requirementCodes: story.requirementCodes,
    dependsOn: story.dependsOn,
  };
  const byCode = new Map(b.current.map((s) => [s.code, s]));
  const blockers = messages([
    ...orphanStories(
      [ref],
      b.approved.map((r) => r.code),
    ),
    ...missingCriteria(
      [ref],
      criteria.map((c) => ({ ...c, storyCode: story.code })),
    ),
    ...missingTasks(
      [ref],
      tasks.map((t) => ({ ...t, storyCode: story.code })),
    ),
    ...unknownDependencies([ref], byCode.keys()),
  ]);
  for (const f of b.reviews.stories.get(story.code) ?? [])
    blockers.push(`Needs review after ${flagLabel(f)} — update it or mark it reviewed`);
  for (const dep of story.dependsOn) {
    if (byCode.get(dep)?.status === "REJECTED")
      blockers.push(`Depends on rejected ${dep} — remove the dependency`);
  }
  const warnings = messages(oversizedTasks(tasks.map((t) => ({ ...t, storyCode: story.code }))));
  const vague = criteria.filter((c) => criterionFlags(c).length).length;
  if (vague)
    warnings.push(`${vague} criteri${vague === 1 ? "on needs" : "a need"} clearer wording`);
  const waiting = story.dependsOn.filter(
    (d) =>
      byCode.get(d) && byCode.get(d)!.status !== "APPROVED" && byCode.get(d)!.status !== "REJECTED",
  );
  if (waiting.length) warnings.push(`Depends on ${waiting.join(", ")}, not approved yet`);
  if (story.evidence === "ASSUMPTION")
    warnings.push("Based on an assumption — confirm it before approving");
  if (story.storyPoints === null) warnings.push("No story points yet");
  if (story.storyPoints === 13) warnings.push("13 points — consider splitting this story");
  return { blockers, warnings };
}

const list = (codes: string[]) =>
  codes.length > 6
    ? `${codes.slice(0, 6).join(", ")} and ${codes.length - 6} more`
    : codes.join(", ");

export function buildState(b: BacklogContext, runs: AgentRun[]): BacklogState {
  const required = requiredCodes(b.approved);
  const versions = new Map<string, number>();
  for (const s of b.rows.stories) versions.set(s.code, (versions.get(s.code) ?? 0) + 1);

  const stories: StoryView[] = b.current.map((story) => {
    const criteria = b.rows.criteria.filter((c) => c.storyId === story.id);
    const tasks = b.rows.tasks.filter((t) => t.storyId === story.id);
    const checks =
      story.status === "DRAFT"
        ? storyChecks(story, b, criteria, tasks)
        : { blockers: [], warnings: [] };
    return {
      ...story,
      epicCode: b.epicCode.get(story.epicId) ?? "EP-??",
      criteria,
      tasks,
      ...checks,
      flags: Object.fromEntries(
        criteria.map((c) => [c.id, criterionFlags(c)]).filter(([, f]) => f.length),
      ),
      totalHours: tasks.reduce((n, t) => n + t.estimateHours, 0),
      versions: versions.get(story.code) ?? 1,
      review: b.reviews.stories.get(story.code) ?? [],
    };
  });

  const live = b.current.filter((s) => s.status !== "REJECTED");
  const approvedStories = b.current.filter((s) => s.status === "APPROVED");
  const covered = linkedBy(live);
  const approvedCovered = linkedBy(approvedStories);
  const drafts = stories.filter((s) => s.status === "DRAFT");
  const coverage = {
    required,
    covered: required.filter((c) => covered.has(c)),
    approvedCovered: required.filter((c) => approvedCovered.has(c)),
    uncovered: required.filter((c) => !covered.has(c)),
    waiting: b.approved.filter((r) => r.evidence === "OPEN_QUESTION").map((r) => r.code),
  };

  const blockers: string[] = [];
  if (b.current.length === 0) blockers.push("Generate the backlog first");
  if (drafts.length)
    blockers.push(
      `${drafts.length} ${drafts.length === 1 ? "story is" : "stories are"} still in draft`,
    );
  const notApproved = required.filter((c) => !approvedCovered.has(c));
  if (b.current.length && notApproved.length) {
    blockers.push(
      `No approved story for ${notApproved.slice(0, 6).join(", ")}${notApproved.length > 6 ? ` and ${notApproved.length - 6} more` : ""}`,
    );
  }
  blockers.push(
    ...messages([...dependencyCycles(live), ...duplicateCodes(b.current, "Story code")]),
  );
  const flagged = [...b.reviews.stories.keys()].sort();
  if (flagged.length)
    blockers.push(
      `${list(flagged)} ${flagged.length === 1 ? "needs" : "need"} review after a requirement change`,
    );

  return {
    gate2Passed: Boolean(b.prd),
    prdVersion: b.prd?.version ?? null,
    requirements: b.approved,
    epics: b.rows.epics,
    stories,
    coverage,
    counts: {
      draft: drafts.length,
      approved: approvedStories.length,
      rejected: stories.filter((s) => s.status === "REJECTED").length,
      ready: drafts.filter((s) => s.blockers.length === 0).length,
      points: approvedStories.reduce((n, s) => n + (s.storyPoints ?? 0), 0),
    },
    pending: {
      stories: b.prd ? coverage.uncovered.length : 0,
      criteria: drafts.filter((s) => s.criteria.length === 0).length,
      tasks: drafts.filter((s) => s.tasks.length === 0).length,
    },
    gate3: { passed: blockers.length === 0 && approvedStories.length > 0, blockers },
    runs,
    review: {
      stories: flagged,
      changes: [
        ...new Set([...b.reviews.stories.values(), b.reviews.prd].flat().map(flagLabel)),
      ].sort(),
    },
  };
}
