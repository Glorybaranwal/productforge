/** Writing stories (PF-042): add by hand, and autosave of a draft's sections. */
import {
  dependencyCycles,
  messages,
  orphanStories,
  unknownDependencies,
} from "@/src/ai/orchestrator/rules";
import { MANAGER_ROLES, requireRole } from "@/src/lib/auth";
import { AppError, parseOrThrow } from "@/src/lib/errors";
import { newId, nowIso } from "@/src/lib/ids";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";

import { audit, current, edited, refreshEpics, requireDraft } from "./access";
import { backlogRepository } from "./repository";
import {
  formatCode,
  nextNumber,
  StoryCreate,
  StorySectionPatch,
  type AcceptanceCriterion,
  type Story,
  type TechnicalTask,
} from "./schema";
import { loadBacklog, requireGate2, type BacklogContext } from "./state";

function validateLinks(
  story: Pick<Story, "code" | "requirementCodes" | "dependsOn">,
  b: BacklogContext,
): void {
  const others = b.current.filter((s) => s.code !== story.code && s.status !== "REJECTED");
  const problems = [
    ...messages(
      orphanStories(
        [story],
        b.approved.map((r) => r.code),
      ),
    ).map((message) => ({ path: "requirementCodes", message })),
    ...messages([
      ...unknownDependencies(
        [story],
        others.map((s) => s.code),
      ),
      ...dependencyCycles([...others, story]),
    ]).map((message) => ({ path: "dependsOn", message })),
  ];
  if (problems.length) throw new AppError("VALIDATION_ERROR", problems[0]!.message, problems);
}

export async function getStory(ctx: WorkspaceContext, storyId: string): Promise<Story> {
  const story = await backlogRepository.findStory(ctx, storyId);
  if (!story) throw new AppError("NOT_FOUND", "Story not found");
  return story;
}

/** A story the PM writes by hand. Criteria and tasks come from "Generate" or are added in the editor. */
export async function addStory(
  ctx: WorkspaceContext,
  projectId: string,
  input: unknown,
): Promise<Story> {
  requireRole(ctx.role, MANAGER_ROLES, "add stories");
  const data = parseOrThrow(StoryCreate, input);
  const b = await loadBacklog(ctx, projectId);
  const prd = requireGate2(b);
  if (!b.rows.epics.some((e) => e.id === data.epicId))
    throw new AppError("VALIDATION_ERROR", "Choose an epic", [
      { path: "epicId", message: "Choose an epic" },
    ]);
  const code = formatCode(
    "US",
    nextNumber(
      b.rows.stories.map((s) => s.code),
      "US",
    ),
    3,
  );
  validateLinks({ code, requirementCodes: data.requirementCodes, dependsOn: [] }, b);
  const now = nowIso();
  const story: Story = {
    ...data,
    id: newId(),
    workspaceId: ctx.workspace.id,
    projectId,
    code,
    version: 1,
    basedOnVersion: null,
    storyPoints: null,
    dependsOn: [],
    evidence: "EXPLICIT",
    rationale: `Added by ${ctx.session.name}.`,
    rejectionReason: null,
    prdVersion: prd.version,
    status: "DRAFT",
    origin: "human",
    agentRunId: null,
    createdBy: ctx.session.userId,
    createdAt: now,
    updatedAt: now,
    approvedBy: null,
    approvedAt: null,
  };
  await backlogRepository.insert(ctx, { stories: [story] });
  await audit(ctx, story, "story.created");
  await refreshEpics(ctx, projectId);
  return story;
}

/** Autosave of one editor section of a draft story. */
export async function updateStorySection(
  ctx: WorkspaceContext,
  storyId: string,
  input: unknown,
): Promise<Story> {
  const patch = parseOrThrow(StorySectionPatch, input);
  const { story, b } = await current(ctx, storyId);
  requireDraft(story);
  const ws = ctx.workspace.id;
  const now = nowIso();
  let saved: Story | null = story;

  if (patch.section === "story") {
    const v = patch.value;
    if (!b.rows.epics.some((e) => e.id === v.epicId))
      throw new AppError("VALIDATION_ERROR", "Choose an epic", [
        { path: "epicId", message: "Choose an epic" },
      ]);
    validateLinks(
      { code: story.code, requirementCodes: v.requirementCodes, dependsOn: v.dependsOn },
      b,
    );
    const before = JSON.stringify([
      story.epicId,
      story.title,
      story.asA,
      story.iWant,
      story.soThat,
      story.priority,
      story.storyPoints,
      story.requirementCodes,
      story.dependsOn,
    ]);
    const after = JSON.stringify([
      v.epicId,
      v.title,
      v.asA,
      v.iWant,
      v.soThat,
      v.priority,
      v.storyPoints,
      v.requirementCodes,
      v.dependsOn,
    ]);
    if (before === after) return story;
    saved = await backlogRepository.updateStory(ctx, storyId, ["DRAFT"], {
      ...v,
      origin: edited(story.origin),
      updatedAt: now,
    });
  } else if (patch.section === "criteria") {
    const old = new Map(b.rows.criteria.filter((c) => c.storyId === storyId).map((c) => [c.id, c]));
    const rows: AcceptanceCriterion[] = patch.value.map((row, position) => {
      const prev = old.get(row.id);
      const same =
        prev &&
        prev.kind === row.kind &&
        prev.given === row.given &&
        prev.when === row.when &&
        prev.then === row.then;
      return {
        ...row,
        workspaceId: ws,
        projectId: story.projectId,
        storyId,
        position,
        status: "DRAFT",
        evidence: prev?.evidence ?? "EXPLICIT",
        origin: same ? prev.origin : prev ? edited(prev.origin) : "human",
        agentRunId: prev?.agentRunId ?? null,
        createdAt: prev?.createdAt ?? now,
        updatedAt: same ? prev.updatedAt : now,
      };
    });
    const ok = await backlogRepository.replaceChildren(
      ctx,
      storyId,
      { criteria: rows },
      { origin: edited(story.origin), updatedAt: now },
    );
    saved = ok ? { ...story, origin: edited(story.origin), updatedAt: now } : null;
  } else {
    const old = new Map(b.rows.tasks.filter((t) => t.storyId === storyId).map((t) => [t.id, t]));
    let next = nextNumber(
      b.rows.tasks.map((t) => t.code),
      "TASK",
    );
    const rows: TechnicalTask[] = patch.value.map((row, position) => {
      const prev = old.get(row.id);
      const same =
        prev &&
        prev.title === row.title &&
        prev.description === row.description &&
        prev.estimateHours === row.estimateHours;
      return {
        ...row,
        workspaceId: ws,
        projectId: story.projectId,
        storyId,
        code: prev?.code ?? formatCode("TASK", next++, 3),
        position,
        sprintId: prev?.sprintId ?? null,
        status: "DRAFT",
        evidence: prev?.evidence ?? "EXPLICIT",
        origin: same ? prev.origin : prev ? edited(prev.origin) : "human",
        agentRunId: prev?.agentRunId ?? null,
        createdAt: prev?.createdAt ?? now,
        updatedAt: same ? prev.updatedAt : now,
      };
    });
    const ok = await backlogRepository.replaceChildren(
      ctx,
      storyId,
      { tasks: rows },
      { origin: edited(story.origin), updatedAt: now },
    );
    saved = ok ? { ...story, origin: edited(story.origin), updatedAt: now } : null;
  }
  if (!saved) throw new AppError("CONFLICT", "This story can no longer be edited");
  await audit(ctx, story, "story.updated", { section: { from: null, to: patch.section } });
  return saved;
}
