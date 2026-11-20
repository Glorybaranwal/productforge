/**
 * Sprint planning and requirement changes in Postgres through the real services (PF-074, ADR-030),
 * on PGlite with the real migrations, every call as the signed-in user under RLS.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";
import { setLLMClient } from "@/src/ai/llm-client";
import type { DbSession } from "@/src/db/client";
import { impactReviews, requirementChanges, sprintItems, sprints } from "@/src/db/schema";
import { setUserRunner, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { approveChange, markReviewed } from "@/src/modules/impact/decide";
import { impactRepository } from "@/src/modules/impact/repository";
import { proposeChange } from "@/src/modules/impact/service";
import { approvePrd, generatePrd, getPrdState } from "@/src/modules/prd/service";
import {
  confirmRequirements,
  getDiscoveryState,
  runDiscovery,
} from "@/src/modules/requirements/discovery-service";
import { requirementRepository } from "@/src/modules/requirements/repository";
import { resolveQuestion } from "@/src/modules/requirements/service";
import { addSource } from "@/src/modules/sources/service";
import { sprintRepository } from "@/src/modules/sprints/repository";
import {
  moveStoryToSprint,
  planProjectSprints,
  saveSprintSettings,
} from "@/src/modules/sprints/service";
import { approveReadyStories } from "@/src/modules/stories/review";
import { generateBacklog } from "@/src/modules/stories/service";
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
let changeId = "";

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
  // Gates 1–3: sprints plan approved stories.
  await addSource(ana, alpha, { name: "Kickoff notes", text: BRIEF });
  await runDiscovery(ana, alpha, null);
  for (const q of (await getDiscoveryState(ana, alpha)).questions)
    await resolveQuestion(ana, q.id, { state: "skipped" });
  await confirmRequirements(ana, alpha);
  await generatePrd(ana, alpha, null);
  await approvePrd(ana, (await getPrdState(ana, alpha)).versions[0]!.id);
  await generateBacklog(ana, alpha, null);
  await approveReadyStories(ana, alpha);
}, 120_000);

afterAll(async () => {
  setUserRunner(null);
  vi.unstubAllEnvs();
  await h?.pg.close();
});

beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

describe("sprints in Postgres (PF-074)", () => {
  it("saves settings and a plan", async () => {
    await saveSprintSettings(ana, alpha, { velocity: 10, startDate: "2026-12-07" });
    const board = await planProjectSprints(ana, alpha, {});
    expect(board.settings).toMatchObject({ velocity: 10, startDate: "2026-12-07", saved: true });
    expect(board.sprints.length).toBeGreaterThan(0);
    const rows = await h.db.select().from(sprints).where(eq(sprints.projectId, alpha));
    expect(rows.every((s) => s.workspaceId === WS.ana && s.capacityPoints === 10)).toBe(true);
  });

  it("moves a story by hand and keeps it pinned", async () => {
    const { items } = await sprintRepository.load(ana, alpha);
    const code = items[0]!.storyCode;
    await moveStoryToSprint(ana, alpha, { storyCode: code, sprintNumber: null });
    expect(await h.db.select().from(sprintItems).where(eq(sprintItems.storyCode, code))).toEqual(
      [],
    );
    await moveStoryToSprint(ana, alpha, { storyCode: code, sprintNumber: 1 });
    const [item] = await h.db.select().from(sprintItems).where(eq(sprintItems.storyCode, code));
    expect(item).toMatchObject({ sprintNumber: 1, pinned: true });
  });

  it("lets only owners, admins and PMs change the plan — in the service and in the database", async () => {
    await expect(planProjectSprints(dev, alpha, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = (await sprintRepository.load(ana, alpha)).sprints.length;
    await sprintRepository.replacePlan(dev, alpha, [], []); // RLS: deletes nothing
    expect((await sprintRepository.load(ana, alpha)).sprints.length).toBe(before);
  });
});

describe("requirement changes in Postgres (PF-074)", () => {
  it("proposes and analyses a change as CR-01", async () => {
    const result = await proposeChange(
      ana,
      alpha,
      {
        kind: "modify",
        requirementCode: "FR-01",
        text: "Customers can view and search transactions",
        evidence: "EXPLICIT",
        reason: "Support asked for search",
      },
      null,
    );
    changeId = result.changeId;
    expect(result).toMatchObject({ code: "CR-01", run: { status: "succeeded" } });
    const [row] = await h.db
      .select()
      .from(requirementChanges)
      .where(eq(requirementChanges.id, changeId));
    expect(row).toMatchObject({
      workspaceId: WS.ana,
      status: "DRAFT",
      number: 1,
      createdBy: "Ana",
    });
  });

  it("lets only owners, admins and PMs decide", async () => {
    await expect(approveChange(dev, changeId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await impactRepository.update(dev, changeId, { status: "APPROVED" })).toBeNull();
  });

  it("approves it: the requirement's next version, and the change is frozen", async () => {
    await approveChange(ana, changeId);
    const fr01 = (await requirementRepository.listByProject(ana, alpha)).find(
      (r) => r.code === "FR-01",
    )!;
    expect(fr01).toMatchObject({ version: 2, status: "APPROVED", approvedBy: USERS.ana });
    const change = (await impactRepository.find(ana, changeId))!;
    expect(change).toMatchObject({ status: "APPROVED", toVersion: 2, decidedBy: "Ana" });
    expect(
      await impactRepository.update(ana, changeId, { reason: "Rewritten history" }),
    ).toBeNull();
  });

  it("records a review mark once", async () => {
    const change = (await impactRepository.find(ana, changeId))!;
    const ref = change.affected.stories[0]!;
    await markReviewed(ana, changeId, { ref, note: "Checked" });
    // The service refuses a second mark; the database keeps the first even if asked twice.
    await expect(markReviewed(ana, changeId, { ref, note: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const marksOf = () =>
      h.db.select().from(impactReviews).where(eq(impactReviews.changeId, changeId));
    const [first] = await marksOf();
    await impactRepository.addReview(ana, {
      ...first!,
      ref: first!.ref as "PRD",
      note: "Again",
      reviewedAt: new Date().toISOString(),
    });
    expect((await marksOf()).map((m) => m.note)).toEqual(["Checked"]);
  });
});

describe("isolation (PF-074)", () => {
  it("keeps every workspace's plan and changes to itself", async () => {
    expect((await sprintRepository.load(ben, alpha)).sprints).toEqual([]);
    expect((await impactRepository.load(ben, alpha)).changes).toEqual([]);
    expect(await impactRepository.find(ben, changeId)).toBeNull();
    const forged = { ...ben, workspace: { ...ben.workspace, id: WS.ana } };
    expect((await impactRepository.load(forged, alpha)).changes).toEqual([]);
  });

  it("passes the data-isolation audit with sprints and changes in place", async () => {
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
