/**
 * PRD versions in Postgres through the real services (PF-072, ADR-028): generate → edit → Gate 2 →
 * edit as n+1, on PGlite with the real migrations, every call as the signed-in user under RLS.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";
import { setLLMClient } from "@/src/ai/llm-client";
import type { DbSession } from "@/src/db/client";
import { prds } from "@/src/db/schema";
import { setUserRunner, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { newId, nowIso } from "@/src/lib/ids";
import { prdRepository } from "@/src/modules/prd/repository";
import {
  approvePrd,
  generatePrd,
  getPrdState,
  startNewVersion,
  updatePrdSection,
} from "@/src/modules/prd/service";
import {
  confirmRequirements,
  getDiscoveryState,
  runDiscovery,
} from "@/src/modules/requirements/discovery-service";
import { resolveQuestion } from "@/src/modules/requirements/service";
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
const rowOf = async (id: string) => (await h.db.select().from(prds).where(eq(prds.id, id)))[0]!;

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
  // Gate 1 first: the PRD is generated from approved requirements.
  await addSource(ana, alpha, { name: "Kickoff notes", text: BRIEF });
  await runDiscovery(ana, alpha, null);
  for (const q of (await getDiscoveryState(ana, alpha)).questions)
    await resolveQuestion(ana, q.id, { state: "skipped" });
  await confirmRequirements(ana, alpha);
}, 60_000);

afterAll(async () => {
  setUserRunner(null);
  vi.unstubAllEnvs();
  await h?.pg.close();
});

beforeEach(() => {
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
});

describe("PRDs in Postgres (PF-072)", () => {
  it("generates version 1 as a draft linked to its run", async () => {
    const { run } = await generatePrd(ana, alpha, null);
    expect(run.status).toBe("succeeded");
    const [v1] = (await getPrdState(dev, alpha)).versions;
    expect(v1).toMatchObject({ version: 1, status: "DRAFT", origin: "ai", agentRunId: run.id });
    expect(await rowOf(v1!.id)).toMatchObject({ workspaceId: WS.ana, createdBy: USERS.ana });
  });

  it("lets a member edit the draft, and regenerating keeps the same draft", async () => {
    const [v1] = (await getPrdState(ana, alpha)).versions;
    const edited = await updatePrdSection(dev, v1!.id, {
      section: "summary",
      value: "Edited by Dev",
    });
    expect(edited).toMatchObject({ origin: "ai_edited", content: { summary: "Edited by Dev" } });
    await generatePrd(ana, alpha, null);
    const versions = (await getPrdState(ana, alpha)).versions;
    expect(versions.map((v) => v.version)).toEqual([1]);
  });

  it("approves only by owners, admins and PMs — in the service and in the database", async () => {
    const [v1] = (await getPrdState(ana, alpha)).versions;
    await expect(approvePrd(dev, v1!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      prdRepository.updateDraft(dev, v1!.id, { status: "APPROVED", approvedAt: nowIso() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await approvePrd(ana, v1!.id);
    expect(approved).toMatchObject({ status: "APPROVED", approvedBy: "Ana" });
  });

  it("never changes an approved version — even for the owner", async () => {
    const [v1] = (await getPrdState(ana, alpha)).versions;
    expect(
      await prdRepository.updateDraft(ana, v1!.id, { content: { ...v1!.content, summary: "x" } }),
    ).toBeNull();
    await expect(
      updatePrdSection(ana, v1!.id, { section: "summary", value: "Rewritten" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await rowOf(v1!.id)).content.summary).toBe(v1!.content.summary);
    const deleting = h.as(USERS.ana, (tx) => tx.delete(prds).where(eq(prds.id, v1!.id)));
    await expect(deleting).rejects.toThrow();
  });

  it("starts version 2 from the approved one, and allows only one open draft", async () => {
    const [v1] = (await getPrdState(ana, alpha)).versions;
    const v2 = await startNewVersion(dev, v1!.id);
    expect(v2).toMatchObject({ version: 2, status: "DRAFT", basedOnVersion: 1 });
    expect((await startNewVersion(dev, v1!.id)).id).toBe(v2.id); // the open draft, not a third
    const now = nowIso();
    await expect(
      prdRepository.insertVersion(ana, {
        ...v2,
        id: newId(),
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getPrdState(ana, alpha)).versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("keeps every workspace's PRDs to itself", async () => {
    const [v1] = (await getPrdState(ana, alpha)).versions;
    expect(await prdRepository.findById(ben, v1!.id)).toBeNull();
    expect(await prdRepository.listByProject(ben, alpha)).toEqual([]);
    const forged = { ...ben, workspace: { ...ben.workspace, id: WS.ana } };
    expect(await prdRepository.listByProject(forged, alpha)).toEqual([]);
    await expect(
      prdRepository.insertVersion(ben, { ...v1!, id: newId(), status: "DRAFT", projectId: alpha }),
    ).rejects.toThrow();
  });

  it("passes the data-isolation audit with PRDs in place", async () => {
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
