/**
 * The AI run log and idempotency records in Postgres through the real services (PF-071, ADR-027),
 * on PGlite with the real migrations, every call as the signed-in user so RLS applies.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditDataIsolation } from "@/scripts/lib/data-audit.mjs";
import { setLLMClient } from "@/src/ai/llm-client";
import type { LLMClient } from "@/src/ai/types";
import type { DbSession } from "@/src/db/client";
import { agentRuns, idempotencyRecords, requirements } from "@/src/db/schema";
import { setUserRunner, type UserRunner } from "@/src/db/scope";
import type { Session } from "@/src/lib/auth";
import { newId, nowIso } from "@/src/lib/ids";
import { agentRunRepository } from "@/src/modules/agent-runs/repository";
import type { AgentRun } from "@/src/modules/agent-runs/schema";
import { getDiscoveryState, runDiscovery } from "@/src/modules/requirements/discovery-service";
import { addSource } from "@/src/modules/sources/service";
import type { WorkspaceContext } from "@/src/modules/workspaces/schema";
import { ensureWorkspace } from "@/src/modules/workspaces/service";
import { BRIEF } from "@/tests/helpers/discovery";

import { createRlsDb, PROJECT, type RlsHarness, USERS, WS } from "./rls-harness";

let h: RlsHarness;
let ana: WorkspaceContext;
let pam: WorkspaceContext;
let dev: WorkspaceContext;
let ben: WorkspaceContext;
const person = (userId: string, name: string): Session => ({
  userId,
  name,
  email: `${name.toLowerCase()}@example.com`,
});
const alpha = PROJECT.alpha;

/** A run row as a stage would start it, `minutesAgo` old. */
const runningRun = (ctx: WorkspaceContext, minutesAgo = 0): AgentRun => ({
  id: newId(),
  workspaceId: ctx.workspace.id,
  projectId: alpha,
  stage: "discovery",
  provider: "demo",
  model: "demo",
  promptVersion: "discovery.v1.md",
  status: "running",
  attempts: 0,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  latencyMs: 0,
  inputHash: "0".repeat(64),
  error: null,
  events: [],
  createdBy: ctx.session.userId,
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  finishedAt: null,
});

const runsOf = (stage: AgentRun["stage"]) =>
  h.db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, alpha), eq(agentRuns.stage, stage)));

beforeAll(async () => {
  h = await createRlsDb();
  const runner = (session: DbSession, fn: never) => h.as(session.userId, fn);
  setUserRunner(runner as unknown as UserRunner);
  setLLMClient(undefined); // demo engine
  vi.stubEnv("DATA_DRIVER", "postgres");
  vi.stubEnv("AUTH_DRIVER", "supabase");
  ana = await ensureWorkspace(person(USERS.ana, "Ana"));
  pam = await ensureWorkspace(person(USERS.pam, "Pam"));
  dev = await ensureWorkspace(person(USERS.dev, "Dev"));
  ben = await ensureWorkspace(person(USERS.ben, "Ben"));
  await addSource(ana, alpha, { name: "Kickoff notes", text: BRIEF });
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

describe("AI run log in Postgres (PF-071)", () => {
  it("logs each stage run and links what it wrote to it", async () => {
    const { run } = await runDiscovery(ana, alpha, null);
    const [row] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    expect(row).toMatchObject({
      workspaceId: WS.ana,
      createdBy: USERS.ana,
      stage: "discovery",
      status: "succeeded",
      attempts: 1,
    });
    expect(row!.tokensIn).toBeGreaterThan(0);
    expect(row!.events.map((e) => e.step)).toContain("persist");
    const written = await h.db
      .select()
      .from(requirements)
      .where(eq(requirements.agentRunId, run.id));
    expect(written.length).toBeGreaterThan(0);
    expect((await getDiscoveryState(dev, alpha)).latestRun?.id).toBe(run.id);
  });

  it("returns the first result for a repeated Idempotency-Key, and runs once", async () => {
    const before = (await runsOf("discovery")).length;
    const first = await runDiscovery(ana, alpha, "click-1");
    const again = await runDiscovery(ana, alpha, "click-1");
    expect(again).toMatchObject({ replayed: true, run: { id: first.run.id } });
    expect((await runsOf("discovery")).length).toBe(before + 1);
    const [record] = await h.db
      .select()
      .from(idempotencyRecords)
      .where(eq(idempotencyRecords.key, "click-1"));
    expect(record).toMatchObject({
      workspaceId: WS.ana,
      resultId: first.run.id,
      createdBy: USERS.ana,
    });
  });

  it("refuses a second run of a stage while one is running, so it's never paid for twice", async () => {
    const inFlight = await agentRunRepository.insert(ana, runningRun(ana));
    await expect(runDiscovery(pam, alpha, null)).rejects.toMatchObject({ code: "CONFLICT" });
    // A teammate can't finish someone else's live run…
    expect(await agentRunRepository.update(dev, inFlight.id, { status: "failed" })).toBeNull();
    // …the person who started it can, and then the next run goes ahead.
    await agentRunRepository.update(ana, inFlight.id, { status: "failed", finishedAt: nowIso() });
    expect((await runDiscovery(pam, alpha, null)).run.status).toBe("succeeded");
  });

  it("doesn't let a run abandoned mid-way block the stage forever", async () => {
    const abandoned = await agentRunRepository.insert(ana, runningRun(ana, 11));
    expect((await runDiscovery(pam, alpha, null)).run.status).toBe("succeeded");
    const [row] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, abandoned.id));
    expect(row!.status).toBe("failed");
    expect(row!.error).toMatch(/^Abandoned/);
  });

  it("logs a failed run and leaves nothing running", async () => {
    const broken: LLMClient = {
      provider: "test",
      model: "broken",
      generateStructured: async () => ({
        data: { nonsense: true },
        usage: { tokensIn: 10, tokensOut: 5 },
        costUsd: 0.001,
        latencyMs: 3,
        provider: "test",
        model: "broken",
      }),
    };
    const { run } = await runDiscovery(ana, alpha, null, { llm: broken });
    expect(run).toMatchObject({ status: "failed", attempts: 2, tokensIn: 20, costUsd: 0.002 });
    expect(
      await h.db.select().from(requirements).where(eq(requirements.agentRunId, run.id)),
    ).toEqual([]);
    const running = (await runsOf("discovery")).filter((r) => r.status === "running");
    expect(running).toEqual([]);
  });

  it("never changes or deletes a finished run", async () => {
    const latest = await agentRunRepository.latestForProject(ana, alpha, "discovery");
    expect(await agentRunRepository.update(ana, latest!.id, { error: "rewritten" })).toBeNull();
    const deleting = h.as(USERS.ana, (tx) =>
      tx.delete(agentRuns).where(eq(agentRuns.id, latest!.id)),
    );
    await expect(deleting).rejects.toThrow();
    const [row] = await h.db.select().from(agentRuns).where(eq(agentRuns.id, latest!.id));
    expect(row!.error).toBe(latest!.error);
  });

  it("keeps every workspace's runs and keys to itself", async () => {
    const latest = await agentRunRepository.latestForProject(ana, alpha, "discovery");
    expect(await agentRunRepository.findById(ben, latest!.id)).toBeNull();
    expect(await agentRunRepository.latestForProject(ben, alpha, "discovery")).toBeNull();
    const forged = { ...ben, workspace: { ...ben.workspace, id: WS.ana } };
    expect(await agentRunRepository.findById(forged, latest!.id)).toBeNull();
    expect(
      await agentRunRepository.findIdempotent(ben, `discovery:${alpha}`, "click-1"),
    ).toBeNull();
    // Ben can't log a run against Ana's project, nor point his rows at Ana's runs.
    await expect(agentRunRepository.insert(ben, runningRun(ben))).rejects.toThrow();
    const smuggle = h.as(USERS.ben, (tx) =>
      tx.execute(sql`insert into requirements (workspace_id, project_id, code, version, text, type,
        evidence, status, origin, agent_run_id)
        values (${WS.ben}, ${PROJECT.bravo}, 'FR-01', 1, 'Smuggled', 'functional', 'EXPLICIT',
        'DRAFT', 'human', ${latest!.id})`),
    );
    await expect(smuggle).rejects.toThrow();
  });

  it("passes the data-isolation audit with the run log in place", async () => {
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
