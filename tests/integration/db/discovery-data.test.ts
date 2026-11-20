/**
 * Discovery data in Postgres through the real services (PF-070, ADR-026): sources → discovery run →
 * edits → questions → Gate 1, on PGlite with the real migrations, every call as the signed-in user.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";
import { setLLMClient } from "@/src/ai/llm-client";
import type { DbSession } from "@/src/db/client";
import { discoveries, requirements, sourceDocuments } from "@/src/db/schema";
import { setUserRunner, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import {
  confirmRequirements,
  getDiscoveryState,
  runDiscovery,
} from "@/src/modules/requirements/discovery-service";
import { requirementRepository } from "@/src/modules/requirements/repository";
import { resolveQuestion, updateRequirement } from "@/src/modules/requirements/service";
import { addSource } from "@/src/modules/sources/service";
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

beforeAll(async () => {
  h = await createRlsDb();
  const runner = (session: DbSession, fn: never) => h.as(session.userId, fn);
  setUserRunner(runner as unknown as UserRunner);
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
  setLLMClient(undefined); // demo engine
  ana = await ensureWorkspace(person(USERS.ana, "Ana"));
  dev = await ensureWorkspace(person(USERS.dev, "Dev"));
  ben = await ensureWorkspace(person(USERS.ben, "Ben"));
}, 60_000);

afterAll(async () => {
  setUserRunner(null);
  vi.unstubAllEnvs();
  await h?.pg.close();
});

// Some tests stub further env vars; keep the backend on Postgres for each one.
beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

describe("discovery data in Postgres (PF-070)", () => {
  it("runs discovery from a source and saves requirements, questions and the summary", async () => {
    const source = await addSource(dev, alpha, { name: "Kickoff notes", text: BRIEF });
    const [stored] = await h.db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, source.id));
    expect(stored).toMatchObject({ workspaceId: WS.ana, createdBy: USERS.dev });

    const { run } = await runDiscovery(ana, alpha, null);
    expect(run.status).toBe("succeeded");
    const state = await getDiscoveryState(dev, alpha);
    expect(state.discovery).toMatchObject({ runCount: 1, status: "draft" });
    expect(state.requirements.length).toBeGreaterThan(0);
    expect(state.requirements.every((r) => r.status === "DRAFT" && r.origin === "ai")).toBe(true);
    expect(state.requirements[0]!.code).toBe("FR-01");
    expect(state.questions.length).toBeGreaterThan(0);
  });

  it("keeps a member's edits when discovery runs again, and replaces untouched drafts", async () => {
    const before = await getDiscoveryState(ana, alpha);
    const target = before.requirements[0]!;
    const edited = await updateRequirement(dev, target.id, { text: `${target.text} (edited)` });
    expect(edited.origin).toBe("ai_edited");

    await runDiscovery(ana, alpha, null);
    const after = await getDiscoveryState(ana, alpha);
    expect(after.discovery?.runCount).toBe(2);
    expect(after.requirements.find((r) => r.id === target.id)?.text).toBe(edited.text);
    const codes = after.requirements.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("lets only owners, admins and PMs approve — in the service and in the database", async () => {
    await expect(confirmRequirements(dev, alpha)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A bug that skips the role check still can't approve: RLS refuses the write.
    await expect(
      requirementRepository.approveDrafts(dev, alpha, USERS.dev, new Date().toISOString()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes Gate 1 once questions are resolved, approving every draft at once", async () => {
    const state = await getDiscoveryState(ana, alpha);
    for (const q of state.questions.filter((q) => q.state === "open"))
      await resolveQuestion(dev, q.id, { state: "skipped" });
    const confirmed = await confirmRequirements(ana, alpha);
    expect(confirmed.discovery).toMatchObject({ status: "confirmed", confirmedBy: "Ana" });
    expect(confirmed.requirements.every((r) => r.status === "APPROVED")).toBe(true);
    const [row] = await h.db.select().from(discoveries).where(eq(discoveries.projectId, alpha));
    expect(row!.status).toBe("confirmed");
  });

  it("never changes an approved requirement in place — even for the owner", async () => {
    const [approved] = (await getDiscoveryState(ana, alpha)).requirements;
    expect(
      await requirementRepository.update(ana, approved!.id, { text: "Rewritten history" }),
    ).toBeNull();
    const [row] = await h.db.select().from(requirements).where(eq(requirements.id, approved!.id));
    expect(row!.text).toBe(approved!.text);

    // A change is a new version of the same code.
    const now = new Date().toISOString();
    const v2 = await requirementRepository.insertVersion(ana, {
      ...approved!,
      id: crypto.randomUUID(),
      version: 2,
      text: `${approved!.text}, within 2 seconds`,
      createdAt: now,
      updatedAt: now,
    });
    expect(v2).toMatchObject({ code: approved!.code, version: 2 });
    const current = await requirementRepository.listByProject(ana, alpha);
    expect(current.find((r) => r.code === approved!.code)?.version).toBe(2);
  });

  it("keeps every workspace's discovery data to itself", async () => {
    expect(await requirementRepository.listByProject(ben, alpha)).toEqual([]);
    // A bug that points Ben at Ana's workspace still finds nothing.
    const forged = { ...ben, workspace: { ...ben.workspace, id: WS.ana } };
    expect(await requirementRepository.listByProject(forged, alpha)).toEqual([]);
    // Ben can't attach a requirement to Ana's project from his own workspace either.
    const now = new Date().toISOString();
    await expect(
      requirementRepository.insert(ben, {
        id: crypto.randomUUID(),
        workspaceId: WS.ben,
        projectId: alpha,
        version: 1,
        text: "Smuggled requirement",
        type: "functional",
        evidence: "EXPLICIT",
        sourceQuote: null,
        rationale: null,
        sourceId: null,
        status: "DRAFT",
        origin: "human",
        agentRunId: null,
        createdAt: now,
        updatedAt: now,
        approvedBy: null,
        approvedAt: null,
      }),
    ).rejects.toThrow();
    const smuggled = await h.db
      .select()
      .from(requirements)
      .where(eq(requirements.text, "Smuggled requirement"));
    expect(smuggled).toEqual([]);
  });

  it("passes the data-isolation audit with real discovery data in place", async () => {
    let report: Awaited<ReturnType<typeof auditDataIsolation>> | undefined;
    await h.pg.transaction(async (tx) => {
      report = await auditDataIsolation(
        async (sql, params) => (await tx.query(sql, params)).rows as Record<string, unknown>[],
      );
      await tx.rollback();
    });
    expect(report!.failures).toEqual([]);
  });
});
