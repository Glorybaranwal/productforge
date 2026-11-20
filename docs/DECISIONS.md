# Architecture Decision Records

Format: **ADR-NNN — Title** · Status (ACCEPTED / OPEN / SUPERSEDED) · Date · Decision · Why · Consequences.
Add new entries at the bottom. Never delete; mark superseded ones instead.

---

### ADR-001 — Modular monolith on Next.js
**Status:** ACCEPTED · 2026-11-18
**Decision:** One Next.js app with domain modules (`src/modules/*`) and service/repository layers. No microservices.
**Why:** Faster to build, debug and demo; a solo developer can hold it in their head.
**Consequences:** The AI worker can be extracted later (Phase 2) if long jobs exceed serverless limits.

### ADR-002 — Fixed pipeline of AI stages, not autonomous agents
**Status:** ACCEPTED · 2026-11-18
**Decision:** One orchestrator runs specialist stages in a fixed order: Discovery → PRD → Stories → QA → Tasks → Sprint.
Each stage is a function with its own prompt, input schema and output schema.
**Why:** Deterministic, testable, easy to evaluate. Human gates sit between stages.
**Consequences:** Stages can be promoted to independent agents with tools later without changing the data model.

### ADR-003 — Zod as the single source of truth for types
**Status:** ACCEPTED · 2026-11-18
**Decision:** Domain types are Zod schemas. The same schemas generate the JSON Schema sent as the model's structured
output format, validate API input, and type the repositories.
**Why:** One definition; AI output, API and DB cannot drift apart.

### ADR-004 — LLM provider behind an interface
**Status:** ACCEPTED · 2026-11-18
**Decision:** All model calls go through `LLMClient` (`src/ai/llm-client.ts`). v1 implementation: OpenAI Responses API
with Structured Outputs.
**Why:** Swap or compare models in evals without touching stages.

### ADR-005 — ORM: Drizzle
**Status:** ACCEPTED · 2026-11-18 · decided by Claude acting as PM, at the user's request (2026-11-18)
**Options considered:** Drizzle · Prisma 7 (stable) · Prisma 8 / "Prisma Next" (Early Access).
**Decision:** Drizzle ORM with the `postgres` (postgres-js) driver. Schema in `src/db/schema/`; `drizzle-kit` generates
plain SQL migrations into `src/db/migrations/`; RLS policies are declared next to their tables with `pgPolicy` and the
`drizzle-orm/supabase` helpers.
**Why (PM view):**
- Tenant isolation is the product's trust promise, and PF-012 is the riskiest Week 1 task. Drizzle has stable,
  documented RLS support: policies live in the schema, are emitted into reviewable SQL migrations, and there is a known
  Supabase pattern for running queries as the signed-in user. Stable Prisma needs hand-written policy SQL plus a client
  extension; the Prisma line with schema-level RLS and a Supabase extension is Early Access — too risky for a 6-week MVP.
- Append-only versioning (ADR-006) leans on SQL features — `max(version) + 1` inserts, partial unique indexes, JSONB —
  which Drizzle expresses directly.
- No client-generation step and a small runtime: simpler CI and Vercel builds for a solo developer.
**Trade-offs accepted:** smaller ecosystem than Prisma; Drizzle's API still moves between releases; no Prisma Studio
(use Supabase Studio or `drizzle-kit studio`).
**Consequences:**
- Only repositories and `src/db/` import `drizzle-orm`, so a later switch stays contained.
- `src/db/client.ts` exposes `withUser(session, fn)` — runs `fn(tx)` in a transaction that sets role `authenticated`
  and `request.jwt.claims`, so RLS applies — and `adminDb`, which bypasses RLS and is allowed only in migrations, seed
  and system jobs, never in route handlers. Request handling always goes through `withUser`.
- Runtime connects through Supabase's transaction pooler with `prepare: false`; migrations use the direct or session
  connection (env var added in PF-010, with `.env.example` updated).
- Zod stays the source of truth for domain types (ADR-003): repositories map rows to Zod-inferred types; domain schemas
  are not generated from tables.
- Pin exact `drizzle-orm` / `drizzle-kit` versions when they are added in PF-011; upgrade as a deliberate task.
- Revisit only if Prisma's schema-level RLS reaches general availability and Drizzle becomes a bottleneck.

### ADR-006 — Append-only versioning for approved artifacts
**Status:** ACCEPTED · 2026-11-18
**Decision:** Requirements, PRDs and stories have a `version` column. Editing an approved row inserts version n+1.
Trace links reference a specific version. "Needs review" is derived when a linked requirement has a newer approved version.
**Why:** Enables audit, version compare and change-impact analysis.

### ADR-007 — REST + SSE
**Status:** ACCEPTED · 2026-11-18
**Decision:** Resource-oriented REST endpoints; generation progress streamed with Server-Sent Events.
GraphQL only if aggregated dashboard queries become painful.

### ADR-008 — Supabase for DB, auth and storage
**Status:** ACCEPTED · 2026-11-18
**Decision:** Supabase Postgres with RLS for tenant isolation, Supabase Auth, Supabase Storage for uploads.
**Why:** One managed platform; RLS gives database-level multi-tenancy.

### ADR-009 — Tooling baseline
**Status:** ACCEPTED · 2026-11-18
**Decision:**
- Path alias `@/*` → repo root, so imports read `@/components/ui/button`, `@/src/lib/utils`, `@/src/modules/...`.
  `components.json` points shadcn at the same aliases.
- TypeScript pinned to `^5.9` (not 6.x) and ESLint to `^9` (not 10) for compatibility with `eslint-config-next` and
  typescript-eslint. Revisit when those support the newer majors.
- Vitest runs in Node by default; component tests start with `// @vitest-environment jsdom`. `globals: true` only so
  Testing Library auto-cleans up; tests still import from `vitest` explicitly.
- Prettier formats code only; `*.md` is ignored so hand-written docs keep their table layout. Prettier is not part of
  `pnpm lint` (`eslint-config-prettier` just disables conflicting rules); use `pnpm format:check`.
- No web fonts yet (system font stack), so `pnpm dev`/`build` don't need Google Fonts access.
**Why:** Predictable imports across `app/`, `components/` and `src/`; fast server-side tests; fewer moving parts.
**Consequences:** Upgrading TypeScript/ESLint majors is a deliberate task, not a drive-by.

### ADR-010 — Eval scoring and CI gating
**Status:** ACCEPTED · 2026-11-18 · decided by Claude acting as PM, at the user's request (2026-11-18)
**Context:** The fixture README left "substring or LLM judge" open until PF-028.
**Decision:**
- **Two-tier matching.** Tier 1 (deterministic): an expected phrase matches an output item when all its content words
  (lower-cased, punctuation and stop-words removed, simple plural folding) appear in that item. Tier 2 (LLM judge): only
  for expected phrases Tier 1 missed, only in full `pnpm eval` runs; versioned prompt `tests/ai-evals/judge.v1.md`,
  temperature 0, JSON verdict `{ match, outputItemId, reason }`. Reports show which tier matched each item.
- **`mustNotInvent` is a hard check:** a listed item appearing with evidence `EXPLICIT` fails that fixture.
- **CI (`pnpm eval:quick`, 5 fixtures, Tier 1 only)** runs on PRs that touch `src/ai/**` or `tests/ai-evals/**`.
  Blocking: schema-valid ≥ 95 % and ≥ 1 clarifying question per fixture (objective, from PF-024). Recall and coverage are
  reported in the PR but non-blocking until the first full baseline report (PF-028); after that they block at
  baseline − 5 points, ratcheting toward the PRD targets.
- **Cost guard:** each eval run has a token cap (env var added in PF-028) and fails fast when it is exceeded.
**Why:** Deterministic CI keeps PRs fast, cheap and non-flaky; the judge catches paraphrases that keyword matching
misses ("notify when a transaction fails" vs "notify on failed transactions"). Gating on a measured baseline catches
regressions without blocking on targets we haven't yet shown are reachable.
**Consequences:** PF-028 builds both tiers, the report and the path-filtered CI job; judge prompt changes bump its
version like stage prompts.

### ADR-011 — Demo mode first, real services behind the same interfaces
**Status:** ACCEPTED · 2026-11-18 · decided by Claude acting as PM, at the user's request
**Context:** The user asked for each module to be fully working and launchable one by one. Supabase, OpenAI and auth
need accounts and keys that aren't set up yet, and blocking every module on them would stall delivery.
**Decision:**
- Every module ships working in **demo mode** with zero setup: a single local user (`DEMO_USER`) with an auto-created
  workspace; data in one JSON document (`src/db/store.ts`) with drivers for a file (`pnpm dev`), memory (tests) and
  browser localStorage (hosted preview). AI stages (from Module 2) run on a deterministic demo engine behind
  `LLMClient`; the OpenAI implementation switches on when `OPENAI_API_KEY` is set.
- Layering is unchanged (CLAUDE.md §6): route handlers → services → repositories. Only repositories touch the store, and
  every query is scoped by `workspaceId`, mirroring RLS. Swapping in Drizzle/Supabase (ADR-005, PF-010–PF-013) replaces
  repositories and `getSession()` only.
- **Module order:** 1 Projects & workspace → 2 Discovery & clarification → 3 PRD → 4 Stories, criteria & tasks →
  5 Traceability → 6 Jira export → 7 Sprint planning → 8 Change impact. Then real infrastructure and deploy.
- Each module is verified end to end in a real browser and published as a clickable preview: https://claude.ai/artifact/UAKA9Kf7A8vRiXNyGbhkWo
**Why:** Working software at every step, a usable demo for stakeholders now, and no rework later because the
interfaces are the production ones.
**Consequences:** Demo-mode writes are not multi-statement transactions (audit entries are a second write); the
Drizzle repositories wrap service operations in one transaction. Demo mode is for local use and previews only — never
deploy it with real customer data.

### ADR-012 — Discovery flow rules (Module 2)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- Inputs are text sources: pasted notes or .txt/.md/.csv files, up to 50,000 characters each. PDF/DOCX extraction
  waits for PF-023 because it needs new dependencies.
- Re-running discovery replaces only untouched AI drafts. Edited, hand-added, rejected and approved requirements, and
  every resolved question, are kept; new items that duplicate them are skipped.
- Answered questions become EXPLICIT requirements that quote the answer (source `answers`); assumptions become
  ASSUMPTION requirements; skipped questions add nothing.
- Gate 1 is blocked while any question is open. Confirming approves every draft and locks discovery: no re-runs and no
  in-place edits (versioned changes arrive with change management, PF-053).
- A failed AI run is a result, not an HTTP error: `POST /api/projects/:id/discovery` returns 200 with
  `status: "failed"` and the message.
- API paths are project-scoped (`/api/projects/:id/discovery`, `/discovery/confirm`, `/sources`, `/requirements`)
  instead of `/api/requirements/analyze|clarify|confirm`; ARCHITECTURE.md updated.
- Live progress (SSE, PF-027) waits until real model latency matters; each run's step log is stored and shown.
- The demo engine is rule-based and deterministic. It is the eval baseline, not a quality claim; with OpenAI the same
  eval measures the model.
**Why:** User work survives re-runs, Gate 1 means something, and no new dependencies are needed yet.

### ADR-013 — PRD generation, editing and Gate 2 (Module 3)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- The PRD is built only from requirements approved at Gate 1. The stage refuses to run before Gate 1 (409).
- Every functional and non-functional item links to ≥ 1 approved requirement code (`FR-01`, `NFR-01`); assumptions
  and open questions may link codes too. Items inherit their evidence label from the linked requirements instead of
  carrying their own, and the editor colours each link chip by that label.
- Rejected requirements go to out of scope, ASSUMPTION requirements to assumptions, and OPEN_QUESTION requirements
  plus questions skipped during clarification to open questions.
- Gate 2 is blocked while any link points to a code that doesn't exist or any approved requirement is not covered.
  Only the latest version can be approved.
- Approved versions are frozen (ADR-006): edits return 409. "Edit as version n+1" copies the approved content into a
  new draft with `basedOnVersion`; there is at most one open draft.
- Regenerating replaces the open draft (with a confirmation if it has been edited); after approval, generating
  creates the next version.
- Editing is per section with autosave; the first edit sets `origin: ai_edited`, and every save is audit-logged with
  section and version.
- The UI exports with "Copy as Markdown"; `GET /api/prds/:id/markdown` serves the same text as a file. Jira and
  other exports stay in PF-050.
- The problem statement and success metrics are drafted from the requirements and flagged as an assumption for
  stakeholders to confirm, because briefs rarely state metrics.
**Why:** Gate 2 then guarantees the PRD claims nothing the requirements don't support and leaves no approved
requirement behind, which is the product's traceability promise. Frozen versions keep an audit trail.
**Consequences:** Changing an approved requirement needs change management (PF-053) before the PRD can follow.
Regenerating discards edits to the open draft, hence the confirmation step.

### ADR-014 — Backlog generation and Gate 3 (Module 4)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- One story per capability requirement. Rules, limits, assumptions and answers that name no user ("returns are
  only allowed within 30 days") attach to the story they constrain and become acceptance criteria — rules as
  negative criteria. Each non-functional requirement gets its own story (in "Quality & compliance", or "Accounts &
  access" for access rules) with the requirement itself as the positive check.
- Requirements still marked `OPEN_QUESTION` get no story: they show as "waiting on an answer" and don't count
  against coverage.
- "Generate" only fills gaps and never replaces or deletes anything: stories for uncovered requirements, then
  criteria and tasks for draft stories without them. The pipeline is story → QA → task and stops at the first
  failed run.
- "Regenerate with note" rewrites one draft or rejected story with its criteria and tasks (with a warning when it
  has been edited). A rejection reason guides the next draft.
- A story can be approved when it links ≥ 1 approved requirement, has ≥ 2 criteria including a negative or edge
  case, has ≥ 1 task, every task is estimated, and it depends on no rejected story. Vague criteria, tasks over
  16 h, unapproved dependencies, assumption-based stories and missing or 13-point estimates are warnings only.
- Gate 3 is derived, not a separate button: it passes when every live story is approved, every requirement
  (except open questions) has an approved story, and there are no dependency cycles or duplicate codes.
  "Approve all ready" approves every draft without blockers.
- Approved stories are frozen with their criteria and tasks (ADR-006); "Edit as version n+1" copies all three.
  The current story is the highest version of its code.
- In demo mode links are stored as codes (`FR-01`, `US-001`); the Drizzle `story_requirements` (with
  requirement version) and `story_dependencies` tables come with PF-011.
- Priority is MoSCoW (Must / Should / Could; "won't" means rejected); story points are Fibonacci; tasks are
  estimated in hours.
- Only approved stories are exported (Markdown now, Jira in PF-050).
- Generating, approving, rejecting, restoring, regenerating, adding and versioning need Owner, Admin or PM;
  editing drafts is open to every member (role tests in PF-061).
**Why:** Rules belong in acceptance criteria, not in stories of their own, and a backlog people have worked on
must never be overwritten by a re-run. Per-story approval matches how teams refine a backlog; the derived gate
keeps the traceability promise.
**Consequences:** A requirement covered only by a rejected story shows as a gap until it's regenerated or
re-covered. Changing an approved requirement still needs change management (PF-053).

### ADR-015 — Traceability score and gaps (Module 5)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- Each approved requirement needs 5 links: it's in the approved PRD, it has a draft or approved story, a linked
  story has testable criteria (≥ 2, including a negative or edge case), a linked story has estimated tasks, and a
  linked story is approved. Rejected stories don't count.
- The traceability score is the average share of those links over requirements that need a story. Open questions
  are left out and shown as "waiting on an answer".
- Statuses: Traced, In review, Incomplete, Story rejected, No story, Waiting on an answer.
- Every gap has a severity (fix first, to do, FYI) and a link to where it is fixed. Story links
  (`/backlog?story=US-003`) open and scroll to that story. Open questions have no fix link yet: discovery is locked
  after Gate 1, and answering later comes with change management (PF-053).
- A story written from an older approved PRD version is flagged (not blocked) once a newer PRD is approved — the
  first step towards "Needs review" (PF-053).
- "Approved stories linked only to approved requirements" is reported as the PRD's success metric (target 100 %).
- The matrix is computed on every read from the existing tables; nothing extra is stored, so it can't drift.
- CSV export is built on the server, neutralises spreadsheet formulas (`=`, `+`, `-`, `@` are prefixed with `'`)
  and is audit-logged as `traceability.exported`; "Copy" and "Download" both go through the API.
**Why:** One number tells a PM how far the backlog is from "every requirement is built, tested and approved", and
the gap list says exactly what to do next. Auditors get a CSV they can open safely.
**Consequences:** Reading the matrix costs one pass over the project's rows per request (fine at demo scale; cache
or a SQL view with Drizzle if projects grow large). Earlier Markdown copies (PRD, backlog) are client-side and not
audit-logged yet — PF-050 brings all exports under the audit log.

### ADR-016 — Jira export (Module 6)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- Two Jira editions. **Jira Cloud** (default): `Issue ID` + `Parent` in one file link stories to epics and sub-tasks
  to stories — Atlassian deprecated Epic Link and Epic Name in Cloud in 2024. **Jira Data Center**: `Epic Name` +
  `Epic Link` (by epic name) for stories, `Issue Id` + `Parent Id` for sub-tasks. This replaces the original
  "Epic Link" column in PF-050.
- Approved stories only, with the epics that contain them and their tasks; drafts and rejected stories never leave.
  A partial export (Gate 3 not passed) is allowed and says so.
- Mapping: summary = title (≤ 255 characters); description = story sentence, numbered acceptance criteria,
  linked requirements, dependencies and a source line (project, story code and version, PRD version, approver),
  written as plain text so it reads the same whether or not Jira renders wiki markup; priority Must/Should/Could →
  High/Medium/Low; story points as-is; labels = `productforge` + requirement codes (one `Labels` column each);
  tasks → sub-tasks with Original Estimate in seconds. The sub-task type name is configurable.
- Rows go parent-first with sequential ids. Recommended maximum 1,500 items per file (Atlassian); bigger exports
  warn.
- JSON uses Jira REST API v3 shapes (`fields` with an Atlassian Document Format description), nested
  epic → story → sub-task, without `project`/`parent` keys or the story-points field id, which differ per site;
  `notes` explains how to fill them in. Syncing to Jira through its API stays out of scope (PRD).
- The import guide in the app targets company-managed projects: team-managed projects can't set epic parents through
  CSV import and use a different story-points field.
- Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so the file is safe to open in a spreadsheet first.
- Every export is audit-logged as `<thing>.exported` (Jira, PRD Markdown, backlog Markdown, traceability CSV); the
  export history and activity feed read from the audit log, so nothing extra is stored. Copy buttons go through
  the API for that reason.
**Why:** Atlassian's current documentation and known issues; one file per edition keeps the import to a single
wizard run, and the audit trail covers every way data leaves ProductForge.
**Consequences:** PF-050's done-when needs a Jira admin and a test project. Some Cloud sites have reported epic
links failing within one file; PF-054 adds a two-step fallback.

### ADR-017 — Sprint planning (Module 7)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Deterministic planner, not a model stage.** Fitting stories into sprints by points, priority and dependencies
  is a rules problem: the same backlog always gives the same plan, every placement carries a reason ("Must; after
  US-001", "fills the space left in sprint 2"), and it costs no tokens. The `sprint` AI stage in ARCHITECTURE is
  dropped; a model may later explain a plan in words, never make it.
- **Only approved stories are planned** (their current version). A story without points, or one that depends on a
  story that isn't approved, is held back in "Not planned" with the reason. Drafts are listed with a link to the
  backlog.
- **Rules:** a story never lands in an earlier sprint than a story it depends on (the same sprint is allowed);
  a sprint never goes over its capacity; Must before Should before Could — a story that a higher-priority story
  depends on is planned at that priority ("Should, but US-002 needs it first"); ties go to the story that unblocks
  the most, then the code. Space a bigger story can't use is filled with the next smaller ready story. A story
  bigger than a whole sprint gets an empty sprint to itself and is flagged "split it". A sprint with capacity 0
  (holidays) is skipped.
- **Velocity:** starts at 5 points per person per two weeks, scaled to the sprint length, as an explicit starting
  point the PM replaces after a sprint or two (PF-055 measures it). Sprint 1 defaults to the next Monday. Settings are
  saved when the PM saves them, plans, or places the first story. A new velocity flows to sprints still at the old
  one; sprints whose capacity the PM changed keep it. Sprint dates come from the start date and the project's sprint
  length; a sprint that would end on a weekend ends on the Friday before.
- **People stay in charge:** drag-and-drop or the keyboard-friendly "Move to" menu places a story anywhere — even
  where it breaks a rule — and pins it there. The board never blocks a move; it recomputes problems on every read
  (dependency order, over capacity, a planned story that went back to draft or was rejected). Re-plan keeps pinned
  stories by default and plans their prerequisites first; "plan from scratch" drops the pins. Dropping a story on
  the empty column after the last sprint opens a new sprint.
- **Storage:** placements live in their own table (`sprint_items`: project, story code, sprint number, position,
  pinned, reason), keyed by story code, so approved stories are never updated (ADR-006) and a re-approved version
  keeps its place. Tasks follow their story, so `technical_tasks.sprint_id` is dropped. Sprint goals are suggested
  from the epics in the sprint; editing one makes it the PM's (re-plans keep it); clearing it hands it back.
- **Forecast:** the number of sprints until the last planned story (empty holiday sprints count) and that sprint's
  end date, shown on the board and the project card.
- Owner/Admin/PM plan and move; every change is audit-logged (`sprints.planned`, `sprints.settings_updated`,
  `sprint.story_moved`, `sprint.updated`).
**Why:** PMs need a plan they can trust and explain to the team, then adjust by hand; a deterministic planner with
reasons and live warnings does that, and keeps Gate 3's rule that approved stories don't change.
**Consequences:** the 5-points-per-person default is a guess until real velocity exists (PF-055). Change impact
(PF-053) will add a banner on the sprint board when a planned story needs review.

### ADR-018 — Change requests and impact (Module 8)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Change requests, not edits.** After Gate 1 a requirement changes only through a change request (CR-01, CR-02…):
  change wording (text and evidence), add a requirement, or withdraw one — always with a reason. Approving inserts
  the requirement's next version (ADR-006); a withdrawal is a new version with status REJECTED. The current
  requirement is the highest version of its code, and every screen and stage reads only current versions. One open
  proposal per requirement; approving fails if the requirement moved on since the proposal. Answering an open
  question after Gate 1 is a wording + evidence change.
- **Rules decide what is affected; the model explains it.** Code finds the affected items from the links: the
  approved PRD's lines that cite the requirement (any addition affects the PRD as a whole), every live story that
  links it, those stories' criteria and tasks, and their sprint placements. A new `impact` stage (prompt
  `impact.v1.md`, demo engine, Zod schema) explains each item and rates it: must change / likely to change /
  check. Its business rules allow only the listed refs, require every story and the PRD to be explained, and
  forbid duplicates, so the model can't invent or hide impact. The analysis runs on proposal (and on demand) so the
  PM decides with the impact in front of them; nothing changes until approval.
- **"Needs review" is derived, never stored on the items.** For each approved change, an affected story stays
  flagged until a version of it is started after the change, it is rejected, or someone marks it reviewed (with an
  optional note); the PRD until a version is approved after the change or it's marked reviewed. Approved rows are
  never touched. Review marks are their own records (`impact_reviews`).
- **Where it shows:** the story card (with the explanation and a "Mark reviewed" action), a backlog banner, Gate 3
  (a flagged draft can't be approved; Gate 3 fails while any story is flagged), the PRD banner, traceability gaps
  (fix first), the Jira export warnings and the sprint board banner and cards. The Changes page lists every request
  with before/after, reason, impact and the review checklist; the project card shows what's left to review.
- Owner/Admin/PM propose, approve, discard and mark reviewed; every step is audit-logged (`change.proposed`,
  `change.approved`, `change.discarded`, `change.reviewed`).
**Why:** Requirements do change after sign-off; the risk is silent drift between the requirement, the PRD, the
stories and the plan. Making change explicit, versioned and reviewed keeps the traceability promise without
freezing the project, and keeping the model to explanations keeps the "what is affected" answer exact.
**Consequences:** the affected set is fixed at approval; stories written later aren't flagged (they were written
against the new version). A requirement's history is only visible through its changes until PF-056 adds a version
compare. The demo engine compares wording word by word; a real model will explain semantic changes better, which
the impact eval measures.

### ADR-019 — Database schema conventions (PF-011)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Drizzle 0.45 (stable), not v1.** In November 2026 Drizzle's latest stable release is 0.45.x; v1.0 is still a
  release candidate with a new migration-folder format and API changes. We pin exact 0.x versions of
  `drizzle-orm` and `drizzle-kit`, plus `postgres` (postgres-js), and move to v1 as its own task once it is stable.
- **Row-level security is on for every table from the first migration**, before any policy exists (PF-012). The
  publishable key is public and Supabase exposes `public` tables through its Data API, so a table without RLS would
  be readable by anyone. With RLS on and no policies, the Data API returns nothing; the server connects as the
  table owner and is unaffected.
- **Identity:** `auth.users` (Supabase Auth) is the only users table. `workspaces.owner_id` and
  `workspace_members.user_id` reference it; members cascade when a user is deleted, owners must hand over first.
  `projects.created_by` and `audit_logs.actor_id` become null instead, and audit entries keep a copy of the actor's
  name.
- **Conventions:** uuid primary keys (`gen_random_uuid()`), snake_case columns mapped to the camelCase domain types,
  `timestamptz` timestamps set by the database, check constraints that mirror the Zod limits (team size 1–100,
  sprint length 7/14/21/28 days), an index for every foreign key used in lookups. `audit_logs.entity_id` is text
  because entities are referenced by uuid or by human code.
- **Migrations:** `pnpm db:generate` writes SQL from `src/db/schema/` into `src/db/migrations/` (committed and
  reviewed like code); `pnpm db:migrate` applies them through the session pooler (`DATABASE_DIRECT_URL`);
  `pnpm db:check` tests the connection and lists every table with its RLS status. drizzle-kit is told Supabase owns
  the built-in roles (`entities.roles.provider = "supabase"`).
**Why:** Tenant isolation is the product's trust promise; turning RLS on first means no window where data is
exposed. Pinning a stable ORM line avoids building on APIs that are still moving.
**Consequences:** Real users must exist in `auth.users` before workspaces can be created, so the database becomes
the app's store only with sign-in (PF-013) and the Drizzle repositories (PF-012/PF-015). Moving to Drizzle v1
later needs `drizzle-kit up` to convert the migrations folder.

### ADR-020 — Row-level security policies and how they're tested (PF-012)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Who sees what:** every policy is for the `authenticated` role; `anon` has none, so it reads nothing.
  - `workspaces`: members (and the owner) read; anyone signed in can create a workspace they own; owners and admins
    rename; only the owner deletes. `owner_id` never changes through user-level access — a transfer will be its own
    audited, server-side flow.
  - `workspace_members`: members read their own and their teammates' memberships (a team page needs them); the owner
    of a new workspace adds themselves as owner; owners and admins add, change and remove members, but only owners
    add or promote owners, and admins can't change or remove an owner; anyone can leave.
  - `projects`: members read; owners, admins and PMs create and edit; owners and admins delete — the same rules as
    the projects service, so a bug in one layer is caught by the other.
  - `audit_logs`: members read; members add entries only as themselves; no update or delete policy, so the trail
    is append-only even for the workspace owner.
- **Membership checks in security-definer functions:** `private.is_member(ws)`, `private.has_role(ws, roles)` and
  `private.workspace_owner(ws)` (custom migration `0001_rls_helpers.sql`; policy helpers in
  `src/db/schema/policies.ts`). They run as the table owner, which RLS doesn't apply to, so a policy never triggers
  another policy. They live in `private` (not exposed by Supabase's Data API; only `authenticated` may use it), are
  `STABLE`, run with an empty `search_path` and use fully qualified names. Inside an UPDATE's check they see the row
  as it was before the statement, which is how "owner unchanged" and "admins can't touch owners" are enforced.
- `(select auth.uid())` is used everywhere so Postgres evaluates it once per statement.
- **Acting as a user:** `withUser(session, fn)` opens a transaction on the transaction pooler, sets
  `request.jwt.claims` / `request.jwt.claim.sub` with `set_config(…, true)` and `SET LOCAL ROLE authenticated`, then
  runs `fn`. Both end with the transaction, so a pooled connection never carries one user's identity to the next.
  `adminDb()` (the table owner, bypasses RLS) is for migrations, seed and system jobs only. Sessions must carry a
  real Supabase user id (uuid).
- **Tests:** `tests/integration/db/rls.test.ts` applies the real migrations to PGlite (in-process Postgres) after a
  small stand-in for what Supabase provides — the `anon` / `authenticated` / `service_role` roles, `auth.users`, and
  Supabase's own `auth.uid()` definition — then acts as several users with the exact statements `withUser` runs.
  It needs no network or Docker, so it runs in `pnpm test` and in CI. New dependency:
  `@electric-sql/pglite` (dev only).
**Revised 2026-11-19:** the first version had no functions and let a user see only their own memberships. The
`workspace_members` insert policy still had to look up `workspace_members` and `workspaces`, whose policies look up
`workspace_members` again, and the first test run failed with "infinite recursion detected in policy" (42P17). The
unapplied migration was retired (it never reached the hosted database) and replaced by the functions above plus a
regenerated policies migration (`0002_late_meteorite.sql`). Tests now also cover privilege escalation inside a
workspace (`tests/integration/db/rls-members.test.ts`; shared setup in `rls-harness.ts`).
**Why:** Isolation between workspaces is the product's trust promise (PRD); proving it with the production
migrations and the production "act as" statements on every test run is the strongest check we can afford now.
**Consequences:** The stand-in must stay faithful to Supabase; a smoke test against local Supabase (PF-010) or the
hosted project can confirm it later. Repositories move from the demo store to `withUser` in PF-015, once sign-in
(PF-013) provides real user ids.

### ADR-021 — Sign-in with Supabase Auth (PF-013)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Methods:** email magic link (always on) and GitHub (shown only when `AUTH_OAUTH_PROVIDERS=github`, so the page
  never offers a provider that isn't set up in Supabase). No passwords.
- **Sessions:** `@supabase/ssr` cookie sessions (PKCE). Next 16 `proxy.ts` (formerly middleware) calls
  `updateSession` on every request except static assets: it refreshes the token, then applies `gate()`
  (`src/lib/auth-gate.ts`): signed-out `/dashboard/**` → `/login?next=…`, signed-out `/api/**` → 401 error body,
  signed-in `/login` → `next`. Refreshed or cleared cookies and Supabase's no-cache headers are copied onto every
  response, including redirects.
- **Verification:** the server trusts only `supabase.auth.getClaims()` (signature checked), never `getSession()`.
  `getSession()` in `src/lib/session.ts` (server-only, cached per request) maps claims to the app `Session`; the
  dashboard layout and every route handler still go through `currentContext()`, so data access checks the user
  again behind the proxy.
- **Sign-in runs on the server:** the login page's server actions call `requestMagicLink` / `startOAuth`
  (`src/lib/supabase/sign-in.ts`); `/auth/callback` finishes either a `code` (OAuth, default email template) or a
  `token_hash` link; `POST /auth/signout` ends the session on this device only. No Supabase client ships to the
  browser. Error messages shown to users are fixed strings; Supabase's details go to the log.
- **No open redirects:** `next` is kept only if it's a path on this site and not a sign-in page (`safeNext`).
- **Modes:** `AUTH_DRIVER` = `supabase` | `demo`; unset means Supabase when its URL and publishable key are set,
  otherwise demo (ADR-011). Demo mode refuses to serve when `VERCEL_ENV=production`.
- **Data:** until PF-015 moves repositories to Postgres, a signed-in user gets their own "My workspace" in the local
  store, keyed by their Supabase user id. The demo user's data stays with demo mode.
- New dependencies: `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.119.2 (Supabase's supported way to keep
  Auth sessions in cookies with Next.js), pinned exactly.
**Why:** Magic links and GitHub fit the audience (PMs and engineers) with no password storage or reset flows.
Following Supabase's own Next.js pattern avoids the classic failures (random sign-outs from double refreshes,
trusting unverified cookies, cached Set-Cookie responses).
**Consequences:** Each environment's `<APP_URL>/auth/callback` must be in Supabase → Authentication → URL
Configuration. Supabase's built-in email only reaches the project's team and is heavily rate-limited, and with the
default template a magic link works only in the browser that asked for it; PF-017 fixes both before launch.

### ADR-022 — Postgres repositories behind the existing interfaces (PF-015)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request
**Decision:**
- **Switch:** `DATA_DRIVER=postgres` keeps workspaces, members, projects and the audit trail in Supabase Postgres;
  anything else keeps them in the demo store (ADR-011). It requires Supabase sign-in (ADR-021) — demo mode's user
  isn't in `auth.users` — and fails loudly otherwise. Modules without tables yet (requirements, PRDs, stories,
  sprints, exports, changes) stay in the demo store (`file`) until their tables land (PF-033 and later); they reach
  projects only through `getProject`, so mixing is safe during the move.
- **Shape:** each of the three modules has `store-repository.ts` and `pg-repository.ts` behind one interface;
  `repository.ts` picks per call, so services and routes are unchanged apart from passing their context (the
  `Scope`: session + optional transaction) to repositories.
- **As the user, always:** every Postgres call runs through `withUser` (role `authenticated` + JWT claims), so RLS
  (ADR-020) applies. Queries still name the workspace; RLS is the backstop if the app ever passes the wrong one. A
  write RLS refuses (SQLSTATE 42501) becomes a `FORBIDDEN` error, not a 500.
- **Units of work:** `unitOfWork(ctx, fn)` runs several repository calls in one transaction in Postgres (create /
  edit / delete a project + its audit entry; first-visit workspace + owner membership + audit entry); the demo store
  just runs them. Other modules' `recordAudit` calls still write on their own.
- **First visit:** a transaction-scoped advisory lock per user (taken only when no workspace is found) stops the
  layout and the page from creating two workspaces at once.
- **Latency:** `actAs` is now one statement (`set_config('role', 'authenticated', true)` plus the claims), saving a
  round trip per transaction; `currentContext()` is cached per request, so a layout and its page share one lookup.
  Malformed ids return "not found" without a query.
- `Project.createdBy` and `AuditLog.actorId` are nullable: the database sets them to null when a user is deleted.
**Why:** Moving the tenant-scoped core first puts the RLS guarantee behind real data now, without a big-bang
rewrite of eight modules; the interfaces from ADR-011 make each move local.
**Consequences:** Existing demo-store data isn't migrated (it's demo data). Hosting on Vercel waits until every
module is in Postgres (the file store needs a writable disk). The browser-preview build must stub `src/db/client`
(Postgres driver). `pnpm db:check` now shows policies and row counts per table.

### ADR-023 — Performance budget and security hardening (after PF-015)
**Status:** ACCEPTED · 2026-11-19 · decided by Claude acting as PM, at the user's request ("fix the performance
issue, data leakage and security checks first")
**Context:** After PF-015 every click took seconds. The dev trace (`.next/dev/trace`) showed compile times of
0.1–0.4 s but renders of 2–7 s: the dev machine (India) talks to the database in eu-west-1 at about 250 ms a round
trip, a transaction costs ~4 round trips, and the project page opened ~11 transactions (every section re-checked the
project) on a 5-connection pool, twice when a form did `router.push` + `router.refresh`. Idle connections closed
after 20 s, so most clicks also paid for new TLS connections. Supabase sessions are verified locally (ES256 keys,
cached JWKS), so auth wasn't the cost.
**Decision — performance:**
- **Budget:** a page render makes at most 2 database transactions after the first visit; anything slower than
  1.5 s is logged as "Slow database transaction" (`src/db/scope.ts`).
- `getProject` is cached per request (React `cache`), so a page's sections share one lookup. Inside a unit of work
  the context is a new object, so writes always read through their own transaction.
- `currentContext()` in Postgres mode remembers each user's workspace and role for 30 s across requests
  (`src/lib/ttl-cache.ts`). RLS checks membership and role on every query regardless; the trade-off is that a role
  change can take 30 s to show in the UI (`forgetContext(userId)` clears it when memberships become editable).
- Connection pool: 10 connections kept open for 4 minutes (they were closed after 20 s).
- No double renders: `router.push` alone after creating or deleting a project.
- `loading.tsx` skeletons for the dashboard and project pages, so a click responds at once.
- Not done, on purpose: pipelining `actAs` with the first query (would save a round trip, but makes it possible for
  a query to run before the role is set — never acceptable).
**Decision — security:**
- Session cookies are `httpOnly` (no script can read them; there's no browser Supabase client) and `secure` when
  `APP_URL` is HTTPS.
- `proxy.ts` refuses state-changing requests to `/api/**` and `/auth/**` from other sites (`Origin` /
  `Sec-Fetch-Site`), in every mode, before anything else runs.
- Security headers on every response (`next.config.ts`): CSP (`default-src 'self'`, no framing, no plugins, forms
  only to us, Supabase and GitHub), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, and
  HSTS in production; API responses are `private, no-store`.
- Data isolation review: every repository read and write in the store-backed modules is filtered by the caller's
  workspace; the one id-only write (agent runs) is now scoped too. All 34 API routes go through `currentContext()`.
- Next.js 16.4.6 and React 19.3.1 include the 2026 security releases; `package.json` floors raised to those versions so
  no install can resolve an older one.
**Security review, round 2 (same day):**
- Found: Supabase grants every privilege on new `public` tables to `anon` and `authenticated`. RLS doesn't cover
  `TRUNCATE`, so any signed-in user (even with no workspace) could empty a table if they ever got raw SQL; visitors held
  every privilege too (RLS showed them nothing). Fixed by custom migration `0003_harden_grants.sql`: `anon` gets
  nothing; `authenticated` keeps only what the policies use; `audit_logs` is insert + select only; the same defaults
  for future tables. Pinned by `tests/integration/db/rls-grants.test.ts`.
- `pnpm db:audit` (`scripts/db-audit.mjs`, logic in `scripts/lib/data-audit.mjs`) audits a live database without
  changing it: RLS on every table, no open policies, privileges, the `private` functions, what a visitor and a
  stranger see, and for every real member that each visible row belongs to one of their workspaces. Its own test
  plants leaks (an open policy, reopened grants, RLS off) and checks it catches them.
- The Data API (PostgREST) isn't used by the app; new projects are created with it off, so our tables can't be reached
  with the publishable key at all.
- Live checks on the running app: signed-out API calls → 401 `no-store`; dashboard → sign-in; all security headers
  present; no `X-Powered-By`; no cookies readable by scripts; no CSP violations on the sign-in page.
- Dependencies: Next.js 16.4.6, React 19.3.1 and drizzle-orm 0.45.4 are past their 2026 security fixes (drizzle's
  identifier-escaping SQL injection was fixed in 0.45.2). No secrets in project files.
**Consequences:** From India, a page still costs about a second against the eu-west-1 database (one or two
transactions); production in the database's region costs milliseconds. PF-018 decides the hosting region; PF-010
(local Supabase) removes the latency for development. The CSP still allows inline scripts (Next.js needs them without
nonces); PF-019 moves to a nonce-based CSP.

### ADR-024 — Hosting region: Mumbai (PF-018)
**Status:** ACCEPTED · 2026-11-19 · decided by the user ("move it to Mumbai"), on Claude's recommendation
**Decision:**
- New Supabase project **productforge-mumbai** (`wvbfqdgpvsihimfnfdei`) in **ap-south-1 (Mumbai)**, Nano, same
  Vercel-managed organization. Created with the **Data API off** (the app reaches Postgres only from the server, and
  Auth doesn't need it) and RLS on by default for new tables. Pooler: `aws-0-ap-south-1.pooler.supabase.com`
  (6543 transaction for runtime, 5432 session for migrations).
- Auth: Site URL `http://localhost:3000`; redirect URL `http://localhost:3000/auth/callback` (add the production URL
  with PF-016).
- When the app is deployed (PF-016), Vercel functions run in `bom1` (Mumbai) next to the database.
- `.env.local` is switched with `pnpm env:supabase --ref … --pooler-host …` (secrets typed hidden, previous file kept as
  a backup); then `db:migrate`, `db:check`, `db:audit`.
- The eu-west-1 project (`uadrrlrqithqtkniktns`) holds only test data; it's paused once the user confirms the move, and
  deleted later. Users sign up again on the new project.
**Why:** The team and first users are in India. From India each round trip to eu-west-1 cost ~250 ms, about a second
per database transaction; Mumbai cuts that to tens of milliseconds, and moving now costs nothing because there's no
real data.
**Result (2026-11-20):** in dev from India the project page renders in 86–226 ms and the dashboard in 86 ms
(2–7 s before). Secrets for the new project were pasted in chat during setup: rotate them before real data goes in.

### ADR-025 — CI checks and preview deploys (PF-016)
**Status:** ACCEPTED · 2026-11-20 · decided by Claude acting as PM, at the user's request
**Decision:**
- **CI (`.github/workflows/ci.yml`)** on every pull request and push to `main`: lint, typecheck, `pnpm test` (including the
  RLS, grants and data-isolation tests on PGlite — no secrets in CI) and `pnpm build`; a separate job fails on high or
  critical advisories in production dependencies (`pnpm audit --prod`). Read-only permissions, no persisted
  credentials, newer pushes cancel older runs.
- **AI evals (`evals.yml`)** only on PRs touching `src/ai/**` or `tests/ai-evals/**`, with the demo engine (no model key
  in CI), as ADR-010 describes.
- **Dependabot** opens weekly PRs for npm packages (minor/patch grouped) and the CI actions, so patches arrive through
  the same checks.
- **Vercel:** functions in `bom1` (Mumbai, next to the database — ADR-024). Pull requests get preview deploys; pushes to
  `main` don't deploy (`git.deploymentEnabled.main = false`). Previews run in **demo mode**: no Supabase variables in
  the Preview environment, data in `/tmp` per server instance, demo AI engine; Vercel Authentication keeps preview URLs
  private. Demo mode already refuses `VERCEL_ENV=production`.
- Production deploys start once every module stores its data in Postgres (the file store needs a writable disk); a
  PF-064 tracks it.
**Why:** Every change is checked the same way before it lands, including the tenant-isolation guarantees, and reviewers
get a clickable preview without any real data or secrets leaving the developer's machine.
**Follow-ups (2026-11-20):** `main` is protected by a ruleset (pull request required, both CI checks must pass,
no force pushes or deletion). Vercel project `productforge-l5ep` builds the repo; an older `productforge` project
(created by the Supabase integration flow) was disconnected from Git. Dependabot's npm job failed on pnpm's minimum
release age (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`): it now waits 3 days before proposing a version and leaves major
upgrades (vitest 5, postgres 4, @vitejs/plugin-react 6) to planned tasks.
**Consequences:** Branch protection on `main` (require the CI checks) is set in GitHub by the repo owner. Preview data
is throwaway. Turning production on means adding the Supabase variables to Vercel's Production environment, the
production URL to Supabase's redirect URLs, and removing the `main: false` rule.

