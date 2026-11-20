/**
 * The backlog in Postgres through the real services (PF-073, ADR-029): generate → edit → Gate 3 →
 * edit as n+1 → traceability, on PGlite with the real migrations, every call under RLS.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";
import { setLLMClient } from "@/src/ai/llm-client";
import type { DbSession } from "@/src/db/client";
import { acceptanceCriteria, stories, technicalTasks } from "@/src/db/schema";
import { setUserRunner, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { newId, nowIso } from "@/src/lib/ids";
import { approvePrd, generatePrd, getPrdState } from "@/src/modules/prd/service";
import {
  confirmRequirements,
  getDiscoveryState,
  runDiscovery,
} from "@/src/modules/requirements/discovery-service";
import { resolveQuestion } from "@/src/modules/requirements/service";
import { addSource } from "@/src/modules/sources/service";
import { updateStorySection } from "@/src/modules/stories/edit";
import { backlogRepository } from "@/src/modules/stories/repository";
import { approveReadyStories, startStoryVersion } from "@/src/modules/stories/review";
import { generateBacklog, getBacklogState } from "@/src/modules/stories/service";
import { getTraceability } from "@/src/modules/traceability/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";
import { ensureWorkspace } from "@/src/modules/workspaces/service";
import { BRIEF } from "@/tests/helpers/discovery";

import { createRlsDb, PROJECT, type RlsHarness, USERS, WS } from "./rls-harness";

let h: RlsHarness;
let ana: WorkspaceContext;
let dev: WorkspaceContext;
let ben: WorkspaceContext;
const person = (userId: string, name: string): Session => ({
  userId,
  name,
  email: `${name.toLowerCase()}@example.com`,
});
const alpha = PROJECT.alpha;
const draftStory = async () =>
  (await getBacklogState(ana, alpha)).stories.find((s) => s.status === "DRAFT")!;

beforeAll(async () => {
  h = await createRlsDb();
  const runner = (session: DbSession, fn: never) => h.as(session.userId, fn);
  setUserRunner(runner as unknown as UserRunner);
  setLLMClient(undefined); // demo engine
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
  ana = await ensureWorkspace(person(USERS.ana, "Ana"));
  dev = await ensureWorkspace(person(USERS.dev, "Dev"));
  ben = await ensureWorkspace(person(USERS.ben, "Ben"));
  // Gates 1 and 2 first: stories are built from the approved PRD.
  await addSource(ana, alpha, { name: "Kickoff notes", text: BRIEF });
  await runDiscovery(ana, alpha, null);
  for (const q of (await getDiscoveryState(ana, alpha)).questions)
    await resolveQuestion(ana, q.id, { state: "skipped" });
  await confirmRequirements(ana, alpha);
  await generatePrd(ana, alpha, null);
  await approvePrd(ana, (await getPrdState(ana, alpha)).versions[0]!.id);
}, 90_000);

afterAll(async () => {
  setUserRunner(null);
  vi.unstubAllEnvs();
  await h?.pg.close();
});

beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

describe("backlog in Postgres (PF-073)", () => {
  it("generates stories, criteria and tasks as drafts, each traced", async () => {
    const { runs } = await generateBacklog(ana, alpha, null);
    expect(runs.map((r) => r.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    const state = await getBacklogState(dev, alpha);
    expect(state.stories.length).toBeGreaterThan(0);
    for (const s of state.stories) {
      expect(s).toMatchObject({ status: "DRAFT", version: 1 });
      expect(s.requirementCodes.length).toBeGreaterThan(0);
      expect(s.criteria.length).toBeGreaterThanOrEqual(2);
      expect(s.tasks.length).toBeGreaterThan(0);
    }
    const [row] = await h.db.select().from(stories).where(eq(stories.id, state.stories[0]!.id));
    expect(row).toMatchObject({ workspaceId: WS.ana, createdBy: USERS.ana });
  });

  it("lets a member edit a draft's criteria", async () => {
    const story = await draftStory();
    const criteria = story.criteria.map(({ id, kind, given, when, then }) => ({
      id,
      kind,
      given,
      when,
      then,
    }));
    criteria[0]!.then = "the result is shown within 2 seconds";
    await updateStorySection(dev, story.id, { section: "criteria", value: criteria });
    const saved = await h.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.storyId, story.id));
    expect(saved.map((c) => c.then)).toContain("the result is shown within 2 seconds");
  });

  it("lets only owners, admins and PMs approve — in the service and in the database", async () => {
    const story = await draftStory();
    await expect(approveReadyStories(dev, alpha)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backlogRepository.setStatus(dev, story.id, ["DRAFT"], {
        status: "APPROVED",
        updatedAt: nowIso(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { approved } = await approveReadyStories(ana, alpha);
    expect(approved.length).toBeGreaterThan(0);
    const tasks = await h.db
      .select()
      .from(technicalTasks)
      .where(eq(technicalTasks.storyId, story.id));
    expect(tasks.every((t) => t.status === "APPROVED")).toBe(true);
  });

  it("never changes an approved story or its children — even for the owner", async () => {
    const story = (await getBacklogState(ana, alpha)).stories.find((s) => s.status === "APPROVED")!;
    expect(
      await backlogRepository.updateStory(ana, story.id, ["APPROVED"], { title: "Rewritten" }),
    ).toBeNull();
    expect(await backlogRepository.replaceChildren(ana, story.id, { criteria: [] })).toBe(false);
    await h.as(USERS.ana, (tx) =>
      tx.delete(acceptanceCriteria).where(eq(acceptanceCriteria.storyId, story.id)),
    );
    const kept = await h.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.storyId, story.id));
    expect(kept.length).toBe(story.criteria.length);
    await expect(
      h.as(USERS.ana, (tx) => tx.delete(stories).where(eq(stories.id, story.id))),
    ).rejects.toThrow();
  });

  it("edits an approved story as version 2, copying its criteria and tasks", async () => {
    const story = (await getBacklogState(ana, alpha)).stories.find((s) => s.status === "APPROVED")!;
    const v2 = await startStoryVersion(ana, story.id);
    expect(v2).toMatchObject({ code: story.code, version: 2, status: "DRAFT", basedOnVersion: 1 });
    const current = (await getBacklogState(ana, alpha)).stories.find((s) => s.code === story.code)!;
    expect(current).toMatchObject({ id: v2.id, version: 2 });
    expect(current.criteria.length).toBe(story.criteria.length);
  });

  it("feeds traceability from Postgres", async () => {
    const trace = await getTraceability(dev, alpha);
    expect(trace.gate1Passed).toBe(true);
    expect(trace.score).toBeGreaterThan(0);
  });

  it("keeps every workspace's backlog to itself", async () => {
    const story = (await getBacklogState(ana, alpha)).stories[0]!;
    expect(await backlogRepository.findStory(ben, story.id)).toBeNull();
    expect((await backlogRepository.load(ben, alpha)).stories).toEqual([]);
    const forged = { ...ben, workspace: { ...ben.workspace, id: WS.ana } };
    expect((await backlogRepository.load(forged, alpha)).stories).toEqual([]);
    const smuggled = {
      ...story.criteria[0]!,
      id: newId(),
      workspaceId: WS.ben,
      projectId: PROJECT.bravo,
      status: "DRAFT" as const,
    };
    await expect(backlogRepository.insert(ben, { criteria: [smuggled] })).rejects.toThrow();
  });

  it("passes the data-isolation audit with the backlog in place", async () => {
    let report: Awaited<ReturnType<typeof auditDataIsolation>> | undefined;
    await h.pg.transaction(async (tx) => {
      report = await auditDataIsolation(
        async (query, params) => (await tx.query(query, params)).rows as Record<string, unknown>[],
      );
      await tx.rollback();
    });
    expect(report!.failures).toEqual([]);
  });
});
