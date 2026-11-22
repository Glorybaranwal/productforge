/**
 * Write-side row-level security for the tables added after the first RLS tests (PF-070 to PF-074,
 * CLAUDE.md §7.9): a member of another workspace can't insert into or update a workspace's rows,
 * and a developer can't write the manager-only tables. Every refusal must be the policy's
 * (42501), and the same statement run by an allowed user must succeed, so a refusal can't come
 * from a mistake in the statement itself.
 */
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRlsDb, expectRlsRefusal, PROJECT, type RlsHarness, USERS, WS } from "./rls-harness";

let h: RlsHarness;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** A second project in Ana's workspace, for the "allowed user" runs of statements whose key is the project. */
const ALPHA2 = id(203);
const RUN = id(301);
const CHANGE = { [PROJECT.alpha]: id(401), [ALPHA2]: id(402) };
const EPIC = id(501);
const STORY = id(601);

type Row = { ws: string; project: string; user: string; n: number };
type Spec = {
  table: string;
  insert: (r: Row) => SQL;
  /** Changes one column of the seeded row in project alpha. */
  update: string;
  /** Developers may write this table (the policy checks membership, not a manager role). */
  memberWrites: { insert: boolean; update: boolean };
};

const SPECS: Spec[] = [
  {
    table: "sprints",
    insert: (
      r,
    ) => sql`insert into sprints (workspace_id, project_id, number, goal, auto_goal, capacity_points)
      values (${r.ws}, ${r.project}, ${10 + r.n}, 'Goal', true, 10)`,
    update: "goal = 'Hijacked'",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "sprint_items",
    insert: (
      r,
    ) => sql`insert into sprint_items (workspace_id, project_id, story_code, sprint_number, position, pinned, reason)
      values (${r.ws}, ${r.project}, ${`US-${900 + r.n}`}, 1, 0, false, 'Must')`,
    update: "reason = 'Hijacked'",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "sprint_settings",
    insert: (r) => sql`insert into sprint_settings (workspace_id, project_id, velocity, start_date)
      values (${r.ws}, ${r.project}, 20, '2026-12-01')`,
    update: "velocity = 99",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "requirement_changes",
    insert: (
      r,
    ) => sql`insert into requirement_changes (workspace_id, project_id, number, kind, reason, status, affected, created_by)
      values (${r.ws}, ${r.project}, ${10 + r.n}, 'add', 'Because', 'DRAFT', '[]'::jsonb, 'Someone')`,
    update: "reason = 'Hijacked'",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "impact_reviews",
    insert: (
      r,
    ) => sql`insert into impact_reviews (workspace_id, project_id, change_id, ref, note, reviewed_by, reviewed_at)
      values (${r.ws}, ${r.project}, ${CHANGE[r.project as keyof typeof CHANGE]}, ${`US-${900 + r.n}`}, 'Seen', 'Someone', now())`,
    update: "note = 'Hijacked'",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "source_documents",
    insert: (
      r,
    ) => sql`insert into source_documents (workspace_id, project_id, name, kind, text, char_count, created_by)
      values (${r.ws}, ${r.project}, 'Notes', 'paste', 'Some notes', 10, ${r.user})`,
    update: "name = 'Hijacked'",
    memberWrites: { insert: true, update: false },
  },
  {
    table: "clarifying_questions",
    insert: (
      r,
    ) => sql`insert into clarifying_questions (workspace_id, project_id, question, reason, state)
      values (${r.ws}, ${r.project}, 'Which channel?', 'Unclear', 'open')`,
    update: "answer = 'Hijacked'",
    memberWrites: { insert: false, update: true },
  },
  {
    table: "discoveries",
    insert: (
      r,
    ) => sql`insert into discoveries (workspace_id, project_id, agent_run_id, run_count, summary, actors, goals, constraints, conflicts, ambiguities, status)
      values (${r.ws}, ${r.project}, ${RUN}, 1, 'Summary', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'draft')`,
    update: "summary = 'Hijacked'",
    memberWrites: { insert: false, update: false },
  },
  {
    table: "epics",
    insert: (
      r,
    ) => sql`insert into epics (workspace_id, project_id, status, evidence, origin, code, title, description)
      values (${r.ws}, ${r.project}, 'DRAFT', 'EXPLICIT', 'human', ${`EP-${10 + r.n}`}, 'Epic', 'Text')`,
    update: "title = 'Hijacked'",
    memberWrites: { insert: false, update: true },
  },
  {
    table: "technical_tasks",
    insert: (
      r,
    ) => sql`insert into technical_tasks (workspace_id, project_id, status, evidence, origin, story_id, code, title, description, estimate_hours, position)
      values (${r.ws}, ${r.project}, 'DRAFT', 'INFERRED', 'human', ${STORY}, ${`TASK-${100 + r.n}`}, 'Task', 'Text', 2, 0)`,
    update: "title = 'Hijacked'",
    memberWrites: { insert: true, update: true },
  },
  {
    table: "idempotency_records",
    insert: (
      r,
    ) => sql`insert into idempotency_records (workspace_id, operation, key, result_id, created_by)
      values (${r.ws}, 'discovery:test', ${`key-${r.n}`}, 'run-1', ${r.user})`,
    update: "result_id = 'hijacked'",
    memberWrites: { insert: true, update: false },
  },
];

/** Seeds workspace A as the table owner (no RLS), the way a system job would. */
async function seed() {
  const { pg } = h;
  const q = (text: string, params: unknown[] = []) => pg.query(text, params);
  await q(
    `insert into projects (id, workspace_id, name, domain, audience, team_size, sprint_length_days, created_by)
     values ($1, $2, 'Alpha 2', 'Fintech', 'Retail customers', 5, 14, $3)`,
    [ALPHA2, WS.ana, USERS.ana],
  );
  await q(
    `insert into agent_runs (id, workspace_id, project_id, stage, provider, model, prompt_version, status,
       attempts, tokens_in, tokens_out, latency_ms, input_hash, events, created_by)
     values ($1, $2, $3, 'discovery', 'demo', 'demo', 'discovery.v1.md', 'succeeded', 1, 0, 0, 0, 'h', '[]', $4)`,
    [RUN, WS.ana, PROJECT.alpha, USERS.ana],
  );
  for (const project of [PROJECT.alpha, ALPHA2]) {
    const change = CHANGE[project as keyof typeof CHANGE];
    await q(
      `insert into sprints (workspace_id, project_id, number, goal, auto_goal, capacity_points)
       values ($1, $2, 1, 'Goal', true, 10)`,
      [WS.ana, project],
    );
    await q(
      `insert into requirement_changes (id, workspace_id, project_id, number, kind, reason, status, affected, created_by)
       values ($1, $2, $3, 1, 'add', 'Because', 'DRAFT', '[]', 'Ana')`,
      [change, WS.ana, project],
    );
  }
  // One row of every table in project alpha, for the update probes.
  const a = [WS.ana, PROJECT.alpha];
  await q(
    `insert into sprint_items (workspace_id, project_id, story_code, sprint_number, position, pinned, reason)
     values ($1, $2, 'US-001', 1, 0, false, 'Must')`,
    a,
  );
  await q(
    `insert into sprint_settings (workspace_id, project_id, velocity, start_date) values ($1, $2, 20, '2026-12-01')`,
    a,
  );
  await q(
    `insert into impact_reviews (workspace_id, project_id, change_id, ref, note, reviewed_by, reviewed_at)
     values ($1, $2, $3, 'PRD', 'Seen', 'Ana', now())`,
    [...a, CHANGE[PROJECT.alpha]],
  );
  await q(
    `insert into source_documents (workspace_id, project_id, name, kind, text, char_count, created_by)
     values ($1, $2, 'Notes', 'paste', 'Some notes', 10, $3)`,
    [...a, USERS.ana],
  );
  await q(
    `insert into clarifying_questions (workspace_id, project_id, question, reason, state)
     values ($1, $2, 'Which channel?', 'Unclear', 'open')`,
    a,
  );
  await q(
    `insert into discoveries (workspace_id, project_id, agent_run_id, run_count, summary, actors, goals, constraints, conflicts, ambiguities, status)
     values ($1, $2, $3, 1, 'Summary', '[]', '[]', '[]', '[]', '[]', 'draft')`,
    [...a, RUN],
  );
  await q(
    `insert into epics (id, workspace_id, project_id, status, evidence, origin, code, title, description)
     values ($1, $2, $3, 'DRAFT', 'EXPLICIT', 'human', 'EP-01', 'Epic', 'Text')`,
    [EPIC, ...a],
  );
  await q(
    `insert into stories (id, workspace_id, project_id, status, evidence, origin, epic_id, code, version, title,
       as_a, i_want, so_that, priority, requirement_codes, depends_on)
     values ($1, $2, $3, 'DRAFT', 'EXPLICIT', 'human', $4, 'US-001', 1, 'Story', 'customer', 'to filter', 'I find it', 'must', '{FR-01}', '{}')`,
    [STORY, ...a, EPIC],
  );
  await q(
    `insert into technical_tasks (workspace_id, project_id, status, evidence, origin, story_id, code, title, description, estimate_hours, position)
     values ($1, $2, 'DRAFT', 'INFERRED', 'human', $3, 'TASK-001', 'Task', 'Text', 2, 0)`,
    [...a, STORY],
  );
  await q(
    `insert into idempotency_records (workspace_id, operation, key, result_id, created_by)
     values ($1, 'discovery:test', 'key-seed', 'run-0', $2)`,
    [WS.ana, USERS.ana],
  );
}

beforeAll(async () => {
  h = await createRlsDb();
  await seed();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

let counter = 0;
const row = (user: string, project: string = PROJECT.alpha): Row => ({
  ws: WS.ana,
  project,
  user,
  n: ++counter,
});

const updateOf = (spec: Spec) =>
  sql`update ${sql.identifier(spec.table)} set ${sql.raw(spec.update)} where workspace_id = ${WS.ana} returning 1`;

/** How many rows `work` changed; a policy that hides every row changes none. */
const changed = async (work: Promise<unknown>) => ((await work) as { rows: unknown[] }).rows.length;

/** How many of the table's rows hold the value the update probes write. */
const hijacked = async (spec: Spec) => {
  const column = spec.update.split(" = ")[0]!;
  const res = await h.pg.query(
    `select count(*)::int as n from ${spec.table} where ${column}::text in ('Hijacked', 'hijacked', '99')`,
  );
  return (res.rows[0] as { n: number }).n;
};

describe("the seed is valid (allowed users can write what the probes try)", () => {
  it.each(SPECS)("$table: the workspace owner can insert the probe row", async (spec) => {
    await h.as(USERS.ana, (tx) => tx.execute(spec.insert(row(USERS.ana, ALPHA2))));
  });
});

describe("a member of another workspace can't write workspace A", () => {
  it.each(SPECS)("$table: insert is refused by the policy", async (spec) => {
    await expectRlsRefusal(h.as(USERS.ben, (tx) => tx.execute(spec.insert(row(USERS.ben)))));
  });

  it.each(SPECS)("$table: update changes nothing", async (spec) => {
    const before = await hijacked(spec);
    // Either the row is invisible (0 rows) or the privilege is missing (42501): never a change.
    try {
      expect(await h.as(USERS.ben, (tx) => changed(tx.execute(updateOf(spec))))).toBe(0);
    } catch (err) {
      await expectRlsRefusal(Promise.reject(err));
    }
    expect(await hijacked(spec)).toBe(before);
  });
});

describe("a developer in workspace A (ADR-014, ADR-028, ADR-035)", () => {
  it.each(SPECS)("$table: insert follows the role the policy asks for", async (spec) => {
    const write = h.as(USERS.dev, (tx) => tx.execute(spec.insert(row(USERS.dev, ALPHA2))));
    if (spec.memberWrites.insert) await write;
    else await expectRlsRefusal(write);
  });

  it.each(SPECS)("$table: update follows the role the policy asks for", async (spec) => {
    const before = await hijacked(spec);
    let rows: number;
    try {
      rows = await h.as(USERS.dev, (tx) => changed(tx.execute(updateOf(spec))));
    } catch (err) {
      await expectRlsRefusal(Promise.reject(err));
      rows = 0;
    }
    if (spec.memberWrites.update) expect(rows).toBeGreaterThan(0);
    else {
      expect(rows).toBe(0);
      expect(await hijacked(spec)).toBe(before);
    }
  });
});
