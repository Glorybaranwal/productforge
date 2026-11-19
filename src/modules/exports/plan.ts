/**
 * What goes to Jira (PF-050): approved stories only, with their epics, acceptance criteria (in the
 * description), requirement codes (as labels) and tasks (as sub-tasks). Pure: built from the
 * backlog data already loaded for the project.
 */
import type { Requirement } from "@/src/modules/requirements/schema";
import { CRITERION_KIND_LABELS, storySentence, type Priority } from "@/src/modules/stories/schema";
import { buildState, type BacklogContext } from "@/src/modules/stories/state";

import type { DescriptionBlock, JiraExportOptions, JiraItem, JiraPlan } from "./schema";

/** MoSCoW → Jira's default priority scheme. */
export const JIRA_PRIORITY: Record<Priority, "High" | "Medium" | "Low"> = {
  must: "High",
  should: "Medium",
  could: "Low",
};

/** Atlassian recommends at most 1,500 work items per CSV import. */
export const JIRA_IMPORT_LIMIT = 1500;
const SUMMARY_MAX = 255;
const LABEL = "productforge";

const summary = (text: string) =>
  text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
/** Jira labels can't contain spaces. */
const label = (text: string) => text.trim().replace(/\s+/g, "-");

export function buildJiraPlan(
  b: BacklogContext,
  options: Pick<JiraExportOptions, "includeTasks">,
): JiraPlan {
  const state = buildState(b, []);
  const approved = state.stories.filter((s) => s.status === "APPROVED");
  const requirements = new Map<string, Requirement>(b.approved.map((r) => [r.code, r]));
  const source = `ProductForge AI · ${b.project.name} · PRD v${state.prdVersion ?? "–"}`;
  const items: JiraItem[] = [];
  let nextId = 1;

  const epics = state.epics.filter((e) => approved.some((s) => s.epicId === e.id));
  const epicIds = new Map<string, number>();
  for (const epic of epics) {
    const stories = approved.filter((s) => s.epicId === epic.id);
    const id = nextId++;
    epicIds.set(epic.id, id);
    items.push({
      id,
      parentId: null,
      level: "epic",
      ref: epic.code,
      summary: summary(epic.title),
      description: [
        { kind: "p", text: epic.description },
        { kind: "p", text: `Approved stories: ${stories.map((s) => s.code).join(", ")}.` },
        { kind: "p", text: `Source: ${source} · ${epic.code}` },
      ],
      priority: null,
      storyPoints: null,
      estimateHours: null,
      labels: [LABEL],
      epicName: summary(epic.title),
    });
  }

  const storyIds = new Map<string, number>();
  for (const epic of epics) {
    for (const s of approved.filter((x) => x.epicId === epic.id)) {
      const id = nextId++;
      storyIds.set(s.id, id);
      const deps = s.dependsOn.map((c) => {
        const dep = state.stories.find((x) => x.code === c);
        return dep ? `${c} (${dep.title})` : c;
      });
      const description: DescriptionBlock[] = [
        { kind: "p", text: storySentence(s) },
        { kind: "h", text: "Acceptance criteria" },
        {
          kind: "ol",
          items: s.criteria.map(
            (c) =>
              `${CRITERION_KIND_LABELS[c.kind]}: Given ${c.given}, when ${c.when}, then ${c.then}.`,
          ),
        },
        { kind: "h", text: "Requirements" },
        {
          kind: "ul",
          items: s.requirementCodes.map(
            (c) => `${c}: ${requirements.get(c)?.text ?? "not an approved requirement"}`,
          ),
        },
        ...(deps.length ? [{ kind: "p" as const, text: `Depends on: ${deps.join(", ")}` }] : []),
        {
          kind: "p",
          text: `Source: ${source} · ${s.code} v${s.version} · approved by ${s.approvedBy ?? "–"} on ${(s.approvedAt ?? "").slice(0, 10)}`,
        },
      ];
      items.push({
        id,
        parentId: epicIds.get(epic.id)!,
        level: "story",
        ref: s.code,
        summary: summary(s.title),
        description,
        priority: JIRA_PRIORITY[s.priority],
        storyPoints: s.storyPoints,
        estimateHours: null,
        labels: [LABEL, ...s.requirementCodes.map(label)],
        epicName: summary(epic.title),
      });
    }
  }

  if (options.includeTasks) {
    for (const s of approved.filter((x) => storyIds.has(x.id))) {
      for (const t of s.tasks) {
        items.push({
          id: nextId++,
          parentId: storyIds.get(s.id)!,
          level: "subtask",
          ref: t.code,
          summary: summary(t.title),
          description: [
            ...(t.description ? [{ kind: "p" as const, text: t.description }] : []),
            { kind: "p", text: `Source: ${source} · ${t.code} · story ${s.code}` },
          ],
          priority: null,
          storyPoints: null,
          estimateHours: t.estimateHours,
          labels: [LABEL],
          epicName: null,
        });
      }
    }
  }

  const drafts = state.stories.filter((s) => s.status === "DRAFT").map((s) => s.code);
  const rejected = state.stories.filter((s) => s.status === "REJECTED").map((s) => s.code);
  const stale = approved.filter(
    (s) => state.prdVersion && s.prdVersion && s.prdVersion < state.prdVersion,
  );
  const flagged = approved.filter((s) => s.review.length).map((s) => s.code);
  const warnings = [
    ...(drafts.length
      ? [
          `${drafts.length} draft ${drafts.length === 1 ? "story is" : "stories are"} left out (${drafts.join(", ")}) — approve them on the backlog to include them.`,
        ]
      : []),
    ...(approved.length && !state.gate3.passed
      ? ["Gate 3 hasn't passed yet: this is a partial backlog."]
      : []),
    ...(stale.length
      ? [
          `${stale.map((s) => s.code).join(", ")} ${stale.length === 1 ? "was" : "were"} written from an older PRD than v${state.prdVersion}.`,
        ]
      : []),
    ...(flagged.length
      ? [
          `${flagged.join(", ")} need${flagged.length === 1 ? "s" : ""} review after a requirement change (${state.review.changes.join("; ")}) — check before exporting.`,
        ]
      : []),
    ...(items.length > JIRA_IMPORT_LIMIT
      ? [
          `${items.length} work items — Atlassian recommends at most ${JIRA_IMPORT_LIMIT} per import; split the file.`,
        ]
      : []),
  ];

  const subtasks = items.filter((i) => i.level === "subtask");
  return {
    items,
    counts: {
      epics: epics.length,
      stories: storyIds.size,
      subtasks: subtasks.length,
      points: approved.reduce((n, s) => n + (s.storyPoints ?? 0), 0),
      hours: subtasks.reduce((n, i) => n + (i.estimateHours ?? 0), 0),
    },
    excluded: { drafts, rejected },
    prdVersion: state.prdVersion,
    gate3Passed: state.gate3.passed,
    warnings,
  };
}

/** A description as plain text: readable in Jira whether or not it renders wiki markup. */
export function descriptionText(blocks: DescriptionBlock[]): string {
  return blocks
    .map((b) =>
      b.kind === "p" || b.kind === "h"
        ? b.text
        : b.items
            .map((item, i) => (b.kind === "ol" ? `${i + 1}. ${item}` : `- ${item}`))
            .join("\n"),
    )
    .join("\n\n");
}
