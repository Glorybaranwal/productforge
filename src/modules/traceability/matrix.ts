/**
 * Traceability matrix (PF-043): follows each approved requirement through the approved PRD to
 * stories, acceptance criteria, tasks and approval, and lists what's missing. Pure: built from
 * the backlog data already loaded for the project.
 */
import { missingCriteria, missingTasks } from "@/src/ai/orchestrator/rules";
import { PRD_SECTIONS, type PrdContent } from "@/src/modules/prd/schema";
import type { Story } from "@/src/modules/stories/schema";
import type { BacklogContext } from "@/src/modules/stories/state";

import { reviewGaps } from "./review-gaps";
import {
  TRACE_STEPS,
  type Gap,
  type RequirementTrace,
  type StoryRef,
  type StoryTrace,
  type TraceStatus,
  type Traceability,
} from "./schema";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);

/** Which approved-PRD sections reference each requirement code. */
function prdSectionsByCode(content: PrdContent | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!content) return map;
  for (const section of PRD_SECTIONS.filter((s) => s.kind === "traced")) {
    const items = content[section.key] as { requirementCodes: string[] }[];
    for (const code of new Set(items.flatMap((i) => i.requirementCodes))) {
      map.set(code, [...(map.get(code) ?? []), section.title]);
    }
  }
  return map;
}

export function buildTraceability(
  b: BacklogContext,
  links: { backlog: string; prd: string; changes: string },
): Traceability {
  const { rows, current } = b;
  const approvedCodes = new Set(b.approved.map((r) => r.code));
  const epics = new Map(rows.epics.map((e) => [e.id, e]));
  const inPrd = prdSectionsByCode(b.prd?.content ?? null);
  const storyHref = (code: string) => `${links.backlog}?story=${encodeURIComponent(code)}`;

  const refs = new Map<string, StoryRef & { ok: { criteria: boolean; tasks: boolean } }>();
  for (const s of current) {
    const criteria = rows.criteria.filter((c) => c.storyId === s.id);
    const tasks = rows.tasks.filter((t) => t.storyId === s.id);
    const count = (kind: string) => criteria.filter((c) => c.kind === kind).length;
    refs.set(s.code, {
      id: s.id,
      code: s.code,
      title: s.title,
      status: s.status,
      version: s.version,
      criteria: { positive: count("positive"), negative: count("negative"), edge: count("edge") },
      tasks: tasks.length,
      hours: tasks.reduce((n, t) => n + t.estimateHours, 0),
      points: s.storyPoints,
      ok: {
        criteria:
          missingCriteria(
            [s],
            criteria.map((c) => ({ ...c, storyCode: s.code })),
          ).length === 0,
        tasks:
          missingTasks(
            [s],
            tasks.map((t) => ({ ...t, storyCode: s.code })),
          ).length === 0,
      },
    });
  }
  const strip = ({ ok: _ok, ...ref }: StoryRef & { ok: unknown }): StoryRef => ref;
  const linking = (code: string, keep: (s: Story) => boolean) =>
    current
      .filter((s) => keep(s) && s.requirementCodes.includes(code))
      .map((s) => refs.get(s.code)!);

  const requirements: RequirementTrace[] = b.approved.map((r) => {
    const live = linking(r.code, (s) => s.status !== "REJECTED");
    const rejected = linking(r.code, (s) => s.status === "REJECTED");
    const steps = {
      prd: inPrd.has(r.code),
      story: live.length > 0,
      criteria: live.some((s) => s.ok.criteria),
      tasks: live.some((s) => s.ok.tasks),
      approved: live.some((s) => s.status === "APPROVED"),
    };
    const waiting = r.evidence === "OPEN_QUESTION";
    const status: TraceStatus = waiting
      ? "waiting"
      : steps.approved
        ? "traced"
        : !steps.story
          ? rejected.length
            ? "rejected_only"
            : "gap"
          : steps.criteria && steps.tasks
            ? "in_review"
            : "incomplete";
    return {
      code: r.code,
      text: r.text,
      type: r.type,
      evidence: r.evidence,
      prdSections: inPrd.get(r.code) ?? [],
      stories: live.map(strip),
      rejected: rejected.map(strip),
      steps,
      score: waiting ? null : TRACE_STEPS.filter((k) => steps[k]).length / TRACE_STEPS.length,
      status,
    };
  });

  const stories: StoryTrace[] = current.map((s) => {
    const epic = epics.get(s.epicId);
    return {
      ...strip(refs.get(s.code)!),
      epicCode: epic?.code ?? "EP-??",
      epicTitle: epic?.title ?? "Unknown epic",
      requirementCodes: s.requirementCodes,
      unknownCodes: s.requirementCodes.filter((c) => !approvedCodes.has(c)),
      dependsOn: s.dependsOn,
      prdVersion: s.prdVersion,
      stale: Boolean(
        b.prd && s.prdVersion !== null && s.prdVersion < b.prd.version && s.status !== "REJECTED",
      ),
    };
  });

  const required = requirements.filter((r) => r.status !== "waiting");
  const count = (key: keyof RequirementTrace["steps"]) =>
    required.filter((r) => r.steps[key]).length;
  const approvedStories = stories.filter((s) => s.status === "APPROVED");
  const live = stories.filter((s) => s.status !== "REJECTED");
  const scores = required.map((r) => r.score ?? 0);

  return {
    gate1Passed: b.approved.length > 0,
    prdVersion: b.prd?.version ?? null,
    score: scores.length
      ? Math.round((scores.reduce((a, n) => a + n, 0) / scores.length) * 100)
      : null,
    coverage: {
      required: required.length,
      inPrd: count("prd"),
      withStory: count("story"),
      testable: count("criteria"),
      estimated: count("tasks"),
      approved: count("approved"),
      waiting: requirements.length - required.length,
    },
    approvedStoriesTraced: pct(
      approvedStories.filter((s) => s.unknownCodes.length === 0).length,
      approvedStories.length,
    ),
    requirements,
    stories,
    gaps: [
      ...reviewGaps(b, { ...links, story: storyHref }),
      ...findGaps(requirements, stories, b.prd !== null, { ...links, story: storyHref }),
    ],
    totals: {
      stories: live.length,
      approvedStories: approvedStories.length,
      criteria: live.reduce(
        (n, s) => n + s.criteria.positive + s.criteria.negative + s.criteria.edge,
        0,
      ),
      tasks: live.reduce((n, s) => n + s.tasks, 0),
      hours: live.reduce((n, s) => n + s.hours, 0),
      points: approvedStories.reduce((n, s) => n + (s.points ?? 0), 0),
    },
  };
}

const list = (codes: string[], max = 6) =>
  codes.length > max
    ? `${codes.slice(0, max).join(", ")} and ${codes.length - max} more`
    : codes.join(", ");

/** What to fix, most serious first, each with where to fix it. */
function findGaps(
  requirements: RequirementTrace[],
  stories: StoryTrace[],
  hasPrd: boolean,
  links: { backlog: string; prd: string; changes: string; story: (code: string) => string },
): Gap[] {
  const gaps: Gap[] = [];
  const noStory = requirements.filter((r) => r.status === "gap").map((r) => r.code);
  if (noStory.length && hasPrd) {
    gaps.push({
      kind: "no_story",
      severity: "blocker",
      message: `${list(noStory)} ${noStory.length === 1 ? "has" : "have"} no story`,
      codes: noStory,
      action: { label: "Fill gaps on the backlog", href: links.backlog },
    });
  }
  for (const r of requirements.filter((x) => x.status === "rejected_only")) {
    const s = r.rejected[0]!;
    gaps.push({
      kind: "rejected_only",
      severity: "blocker",
      message: `${r.code} lost its story: ${s.code} was rejected`,
      codes: [r.code, ...r.rejected.map((x) => x.code)],
      action: { label: `Regenerate ${s.code}`, href: links.story(s.code) },
    });
  }
  for (const s of stories.filter((x) => x.unknownCodes.length && x.status !== "REJECTED")) {
    gaps.push({
      kind: "orphan_story",
      severity: "blocker",
      message: `${s.code} links to requirements that aren't approved: ${s.unknownCodes.join(", ")}`,
      codes: [s.code, ...s.unknownCodes],
      action: { label: `Fix ${s.code}`, href: links.story(s.code) },
    });
  }
  for (const s of stories.filter((x) => x.status === "DRAFT")) {
    const missing = [
      s.criteria.negative + s.criteria.edge === 0 ||
      s.criteria.positive + s.criteria.negative + s.criteria.edge < 2
        ? "testable criteria"
        : null,
      s.tasks === 0 ? "tasks" : null,
    ].filter(Boolean);
    if (missing.length) {
      gaps.push({
        kind: s.tasks === 0 && missing.length === 1 ? "no_tasks" : "no_criteria",
        severity: "warning",
        message: `${s.code} needs ${missing.join(" and ")}`,
        codes: [s.code, ...s.requirementCodes],
        action: { label: `Open ${s.code}`, href: links.story(s.code) },
      });
    }
  }
  const drafts = stories.filter((x) => x.status === "DRAFT").map((x) => x.code);
  if (drafts.length) {
    gaps.push({
      kind: "not_approved",
      severity: "warning",
      message: `${list(drafts)} ${drafts.length === 1 ? "is" : "are"} not approved yet`,
      codes: drafts,
      action: { label: "Review on the backlog", href: links.backlog },
    });
  }
  for (const s of stories.filter((x) => x.stale)) {
    gaps.push({
      kind: "stale_story",
      severity: "warning",
      message: `${s.code} was written from PRD v${s.prdVersion} — check it still fits the approved PRD`,
      codes: [s.code],
      action: { label: `Open ${s.code}`, href: links.story(s.code) },
    });
  }
  const notInPrd = requirements
    .filter((r) => r.status !== "waiting" && !r.steps.prd)
    .map((r) => r.code);
  if (notInPrd.length && hasPrd) {
    gaps.push({
      kind: "not_in_prd",
      severity: "warning",
      message: `${list(notInPrd)} ${notInPrd.length === 1 ? "isn't" : "aren't"} in the approved PRD`,
      codes: notInPrd,
      action: { label: "Open the PRD", href: links.prd },
    });
  }
  const waiting = requirements.filter((r) => r.status === "waiting").map((r) => r.code);
  if (waiting.length) {
    gaps.push({
      kind: "waiting",
      severity: "info",
      message: `${list(waiting)} ${waiting.length === 1 ? "is an open question" : "are open questions"} — no story until answered. Once you have the answer, change the requirement's wording and evidence with a change request.`,
      codes: waiting,
      action: { label: "Propose a change", href: links.changes },
    });
  }
  return gaps;
}
