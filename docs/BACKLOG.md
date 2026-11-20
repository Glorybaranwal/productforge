# Backlog

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · **(ask first)** = confirm with the user before starting
**Picking rule:** first `[~]`, else the first `[ ]` whose dependencies are all `[x]` (see CLAUDE.md §1).
**MVP = Weeks 0–4.** Week 5 items marked *stretch* are optional.
**Delivery order (ADR-011):** modules ship one by one in demo mode, then real services plug in.
Module 1 Projects & workspace (PF-014, PF-015) · 2 Discovery & clarification (PF-020–PF-027) · 3 PRD (PF-030–PF-032) ·
4 Stories, criteria & tasks (PF-033, PF-034, PF-040–PF-042, PF-044) · 5 Traceability (PF-043) · 6 Export (PF-050) ·
7 Sprints (PF-051, PF-052) · 8 Change impact (PF-053). Live preview: https://claude.ai/artifact/UAKA9Kf7A8vRiXNyGbhkWo

---

## Week 0 — Foundations

- [x] **PF-001 — Initialise the repository**
  - Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui, pnpm, ESLint, Prettier, Vitest.
  - Create the folder layout from CLAUDE.md §6 (folders already have `.gitkeep`).
  - Add the scripts from CLAUDE.md §5 (stubs are fine for db/eval).
  - **Done when:** `pnpm dev` serves a page; `pnpm lint && pnpm typecheck && pnpm test` pass.
  - _2026-11-18: scaffold written (configs, shadcn Button, home page, 2 test files). Not yet installed — Claude's sandbox
    has no npm registry access. Next: `pnpm install && pnpm dev`, then the three checks; fix anything that fails._
  - _2026-11-19: checks green on the Mac; `pnpm dev` serves the app (signed in through it for PF-013)._
- [x] **PF-002 — Decide the ORM (ask first)**
  - Ask the user Drizzle vs Prisma; record in ADR-005.
  - **Done when:** ADR-005 is ACCEPTED.
  - _2026-11-18: user delegated the call; Drizzle chosen (ADR-005)._
- [ ] **PF-003 — Domain Zod schemas** · Depends on: PF-001
  - `Evidence`, `ArtifactStatus`, `Requirement`, `ClarifyingQuestion`, `Prd` (+ sections), `Epic`, `UserStory`,
    `AcceptanceCriterion`, `TechnicalTask`, `Sprint` in `src/modules/*/schema.ts`.
  - Story requires `requirementIds.min(1)` and `acceptanceCriteria.min(2)`.
  - **Done when:** unit tests pass for one valid and two invalid samples per schema.
- [x] **PF-004 — AI eval fixtures** · Depends on: —
  - 20 fixtures in `tests/ai-evals/fixtures/` using the format in its README:
    5 normal, 4 vague, 4 contradictory, 4 missing-info, 3 complex.
  - **Done when:** 20 JSON files exist and a schema test validates their format.
  - _2026-11-18: 20 fixtures (quick set 001/006/010/014/019), `tests/ai-evals/fixture-schema.ts` and
    `tests/unit/ai-evals/fixtures.test.ts` written; schema checked against all 20 with Zod 4 here. Mark `[x]` once
    `pnpm test` passes locally._

## Week 1 — SaaS foundation

- [~] **PF-010 — Supabase project + environment** · Depends on: PF-001
  - Local Supabase (CLI) + hosted project; `.env.example` complete.
  - **Done when:** app connects to local and hosted DB.
  - _2026-11-19: hosted project "productforge" (`uadrrlrqithqtkniktns`, eu-west-1, Nano, Vercel-managed org).
    `.env.local` holds the URL, publishable key and pooler connection strings (transaction 6543 for runtime,
    session 5432 for migrations). `.env.example` now uses the new key names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
    `SUPABASE_SECRET_KEY`) because Supabase retires the legacy anon/service_role keys in early 2027, plus
    `DATABASE_DIRECT_URL`. Database password and secret key in place (PF-011's migration ran). **Remaining:** local
    Supabase via the CLI (needs Docker), for offline development and the RLS integration tests._
- [x] **PF-011 — Core tables + migrations** · Depends on: PF-002, PF-010
  - `workspaces`, `workspace_members` (role enum), `projects`, `audit_logs`.
  - Drizzle schema in `src/db/schema/`, SQL migrations via `drizzle-kit` in `src/db/migrations/` (ADR-005).
  - **Done when:** `pnpm db:migrate` creates them from scratch.
  - _2026-11-19: schema written (`src/db/schema/`: uuid keys, `member_role` enum, FKs to `auth.users`, check
    constraints mirroring the Zod limits, indexes for the activity feed and RLS lookups, RLS enabled on every
    table), `drizzle.config.ts`, `pnpm db:generate` / `db:migrate` / `db:check`, schema unit tests. The app keeps
    using the demo store until the repositories switch (PF-012/PF-015). See ADR-019._
  - _2026-11-19: `0000_bitter_flatman.sql` applied to the hosted project: the four tables exist with RLS on and no
    policies (Supabase: "no data will be returned via the Data API"). drizzle-orm 0.45.4, drizzle-kit 0.31.11,
    postgres 3.4.9, pinned exactly._
- [x] **PF-012 — RLS for workspace isolation** · Depends on: PF-011
  - Policies: members read/write their workspace's rows only.
  - `src/db/client.ts`: `withUser(session, fn)` (role `authenticated` + JWT claims per transaction) and `adminDb` (ADR-005).
  - **Done when:** integration test proves user A cannot read user B's project.
  - _2026-11-19: policies on all four tables (`src/db/schema/`, helpers in `policies.ts`), `withUser` / `adminDb()` /
    `actAs` in `src/db/client.ts`, and `tests/integration/db/rls.test.ts` running the real migrations on PGlite
    with a Supabase stand-in. See ADR-020._
  - _2026-11-19: first run hit "infinite recursion detected in policy"; membership checks moved into security-definer
    functions in `private` (`0001_rls_helpers.sql`), policies regenerated (`0002_late_meteorite.sql`), teammates
    visible, admins can't create or touch owners, ownership can't change. Same scenarios verified on PGlite in
    Claude's VM; on the Mac `lint`, `typecheck`, `test` passed and `db:migrate` applied 0001 + 0002 to the hosted
    project (`db:check` green)._
- [x] **PF-013 — Authentication** · Depends on: PF-010
  - Supabase Auth (email magic link + GitHub OAuth), middleware protecting `/dashboard/**` and `/api/**`.
  - **Done when:** logged-out users are redirected; session available in route handlers.
  - _2026-11-19: `proxy.ts` + `src/lib/supabase/` (config, server client, `updateSession`, sign-in flows),
    `src/lib/auth-gate.ts`, `src/lib/session.ts` (`getClaims()`), `/login` (magic link + GitHub when enabled),
    `/auth/callback`, `/auth/signout`, sign-out in the header. `AUTH_DRIVER` keeps demo mode. Tests: gate rules,
    config, session mapping, proxy, callback, actions, a route handler with a Supabase session. See ADR-021. Real magic-link sign-in verified on the Mac against the
    hosted project; `/auth/callback` added to Supabase's redirect URLs. GitHub waits on an OAuth app (optional)._
- [x] **PF-014 — Shared server lib** · Depends on: PF-001
  - `src/lib/errors.ts` (error shape), `logger.ts`, `idempotency.ts`, `auth.ts` (`requireRole`).
  - **Done when:** unit tests cover each helper.
  - _2026-11-18 (Module 1): errors, http, auth (`requireRole`), ids, logger, format, api-client done with tests.
    `idempotency.ts` lands with the first generation endpoint (PF-024)._
- [x] **PF-015 — Workspaces & projects (API + UI)** · Depends on: PF-012, PF-013, PF-014
  - `POST/GET /api/projects`, dashboard listing projects, "New project" form (name, domain, audience, team size,
    sprint length).
  - **Done when:** a new user signs up, gets a default workspace, creates a project, sees it listed.
  - _2026-11-18 (Module 1, demo mode): default workspace on first visit; create/list/view/edit/delete projects;
    audit trail; API + screens; 31 new tests + 12 browser E2E checks green. Real sign-up waits on PF-013._
  - _2026-11-19: Postgres repositories for workspaces, members, projects and audit behind the same interfaces
    (`DATA_DRIVER=postgres`, ADR-022), as the signed-in user via `withUser`; project changes + audit entries and the
    first-visit workspace are single transactions; one-statement `actAs`; per-request `currentContext()`.
    `tests/integration/db/repositories.test.ts` (7) runs the real services on PGlite under RLS. Real flow on the Mac
    (sign up → default workspace → create project → listed) confirmed by the user; closed at their request._
- [x] **PF-016 — CI/CD** · Depends on: PF-001
  - GitHub Actions: lint, typecheck, test on PRs; Vercel preview per PR; production on `main`.
  - **Done when:** a PR shows green checks and a preview URL.
  - _2026-11-20: CI (`ci.yml`: lint, typecheck, test, build + dependency audit), path-filtered quick evals (`evals.yml`),
    Dependabot, `vercel.json` (`bom1`, no auto-deploy from `main`), file store falls back to `/tmp` on Vercel. See
    ADR-025. Project pushed to `Glorybaranwal/productforge` (public); first CI run on `main` green (lint, typecheck,
    test, build ~70 s; dependency audit clean). Closed by the PR that carries this note, once it shows checks + a preview._
- [ ] **PF-017 — Auth emails for production** · Depends on: PF-013
  - Custom SMTP (Supabase's built-in email only reaches the project team, a few emails an hour) and branded
    magic-link template linking to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`, so a link
    opened on another device works (`/auth/callback` already accepts it).
  - **Done when:** a link requested on a laptop signs in on a phone; an address outside the team receives it.
- [x] **PF-018 — Hosting region (ask first)** · Depends on: PF-015
  - The database is in eu-west-1; the team (and likely first users) are in India: ~250 ms per round trip. Either keep
    eu-west-1 and pin Vercel functions to `dub1`, or move Supabase to ap-south-1 (Mumbai) with Vercel `bom1` while
    there's no real data. Record in an ADR; set `regions` in `vercel.json` with PF-016.
  - **Done when:** app servers and database share a region; a project page renders in < 300 ms server-side.
  - _2026-11-19: user chose Mumbai (ap-south-1): new project with the Data API off; `pnpm env:supabase` to switch,
    `db:migrate` + `db:audit` to verify; the eu-west-1 project stays until the user confirms, then is paused._
  - _2026-11-20: done. `productforge-mumbai` (`wvbfqdgpvsihimfnfdei`) migrated (0000–0003), `db:audit` clean; measured in
    dev from India: project page 86–226 ms, dashboard 86 ms (were 2–7 s). `adminDb()` now reopens its pool when
    `DATABASE_URL` changes (a stale pool kept the old password after the switch)._
- [ ] **PF-019 — Nonce-based CSP** · Depends on: PF-013
  - Replace `'unsafe-inline'` scripts with per-request nonces set in `proxy.ts` (ADR-023).
  - **Done when:** the CSP has no `'unsafe-inline'` for scripts and every page still works.

## Week 2 — AI discovery

- [x] **PF-020 — LLMClient** · Depends on: PF-003
  - Interface `generateStructured<T>({ system, input, schema, model? })` → `{ data, usage, latencyMs }`.
  - OpenAI implementation with Structured Outputs, 60 s timeout, one retry on 429/5xx.
  - **Done when:** unit tests with a mocked client; one live smoke test behind an env flag.
  - _2026-11-19 (Module 2): `src/ai/llm-client.ts` + OpenAI Responses client (60 s timeout, one retry on 429/5xx) + demo engine; mocked tests green. Live smoke test: `RUN_LIVE_LLM_TESTS=true pnpm test` with `OPENAI_API_KEY`._
- [x] **PF-021 — agent_runs logging** · Depends on: PF-011, PF-020
  - Table + repository: stage, model, status, tokens in/out, cost, latency, error, input hash.
  - **Done when:** every LLMClient call through the orchestrator writes a row.
  - _2026-11-19 (Module 2): every stage run is logged (provider, model, prompt version, attempts, tokens, cost, latency, input hash, step events) — demo store now, Supabase table with PF-011._
- [x] **PF-022 — Orchestrator stage runner** · Depends on: PF-020, PF-021
  - `runStage(stage, ctx)`: load context → call model → Zod validate → business rules → retry once with errors →
    save drafts in one transaction → update run.
  - **Done when:** unit tests cover success, invalid-then-valid, invalid-twice.
  - _2026-11-19 (Module 2): `runStage` with Zod + business rules, one retry with the errors, persist, run log; tests cover success, invalid-then-valid, invalid-twice and provider errors._
- [ ] **PF-023 — Document upload + extraction** · Depends on: PF-015
  - PDF/DOCX/TXT ≤ 10 MB, MIME check, Supabase Storage, text extraction server-side, `source_documents` table.
  - **Done when:** an uploaded PDF's text is stored and visible in the project.
- [x] **PF-024 — Discovery stage** · Depends on: PF-022
  - Prompt `src/ai/prompts/discovery.v1.md`; output: requirements (with evidence + type), actors, goals, constraints,
    clarifying questions, conflicts, ambiguity flags with a suggested measurable question.
  - `requirements` table (versioned, ADR-006).
  - **Done when:** `pnpm eval:quick` shows ≥ 95 % schema-valid; every fixture yields ≥ 1 question.
  - _2026-11-19 (Module 2): prompt `discovery.v1.md`, stage + rules (EXPLICIT must quote its source verbatim), versioned requirements with codes; demo-engine eval 100 % schema-valid, ≥ 1 question on every fixture._
- [x] **PF-025 — Discovery workspace UI** · Depends on: PF-024
  - Input box + upload, requirements list with evidence badges, questions panel, conflicts panel.
  - **Done when:** user runs discovery and sees results without a page reload.
  - _2026-11-19 (Module 2): discovery page — sources (paste, .txt/.md upload, sample brief), requirements with evidence badges and quotes, questions, conflicts, vague terms; no page reloads._
- [x] **PF-026 — Clarification loop (Gate 1)** · Depends on: PF-025
  - Answer / skip / mark-as-assumption each question → re-run discovery with answers → "Confirm requirements".
  - **Done when:** confirmed requirements are `APPROVED` and audit-logged.
  - _2026-11-19 (Module 2): answer / skip / assume, re-run keeps your edits, Gate 1 blocked while questions are open; confirmation approves and audit-logs._
- [ ] **PF-027 — SSE progress** · Depends on: PF-022
  - `GET /api/agent-runs/:id/stream`; UI shows stage progress and errors.
  - **Done when:** progress events appear in the UI during a run.
- [x] **PF-028 — Eval runner v1** · Depends on: PF-004, PF-024
  - `pnpm eval` runs discovery on all fixtures; reports schema validity, question count, expected-requirement recall.
  - Two-tier scoring, `mustNotInvent` check, token cap and path-filtered CI job per ADR-010.
  - **Done when:** report written to `tests/ai-evals/reports/<date>.md`.
  - _2026-11-19 (Module 2): `pnpm eval` / `pnpm eval:quick` (Vitest config `vitest.eval.config.mts`) write `tests/ai-evals/reports/<date>-discovery-<provider>.md` with ADR-010 Tier 1 scores. Tier 2 judge → PF-029._

- [ ] **PF-029 — Eval Tier 2 judge** · Depends on: PF-028
  - LLM judge for expected items Tier 1 missed (ADR-010): `tests/ai-evals/judge.v1.md`, temperature 0, JSON verdict.
  - **Done when:** full `pnpm eval` reports which tier matched each item.

## Week 3 — PRD and stories

- [x] **PF-030 — PRD stage** · Depends on: PF-026
  - Prompt `prd.v1.md`; sections: summary, problem, goals + metrics, personas, scope / out of scope, FRs, NFRs,
    dependencies, assumptions, risks. Each FR/NFR references requirement IDs.
  - `prds` table (version, JSONB content, status).
  - **Done when:** PRD generated for 5 fixtures, all schema-valid.
  - _2026-11-19 (Module 3): `prd` stage (`prd.v1.md`) + demo engine; every FR/NFR item links ≥ 1 approved requirement code; a coverage rule rejects unknown or uncovered codes and retries once. PRD eval: 5/5 schema-valid and fully traced. Stored in the demo store's `prds` collection; the Drizzle table comes with PF-011._
- [x] **PF-031 — PRD editor** · Depends on: PF-030
  - Section-by-section editing, autosave as draft, assumptions highlighted.
  - **Done when:** edits persist; `origin` becomes `ai_edited`.
  - _2026-11-19 (Module 3): one card per section, 0.8 s autosave with a client-side Zod check, requirement-link chips coloured by evidence label, assumptions highlighted amber; the first edit sets `origin: ai_edited`; each save logs `prd.updated` with section and version._
- [x] **PF-032 — PRD versions + approval (Gate 2)** · Depends on: PF-031
  - Approve freezes version n; editing after approval creates n+1; side-by-side compare.
  - **Done when:** v1 stays intact after editing an approved PRD; audit log records both.
  - _2026-11-19 (Module 3): Gate 2 blocked until every approved requirement is covered and no link is unknown; approved versions are frozen (PATCH → 409); "Edit as version n+1" copies them into a new draft; compare view diffs any two versions by section; Copy as Markdown. Audit: `prd.generated`, `prd.updated`, `prd.approved`, `prd.version_created`. See ADR-013._
- [~] **PF-033 — Epics & stories tables** · Depends on: PF-011
  - `epics`, `user_stories` (versioned), `story_requirements`, `story_dependencies`.
  - **Done when:** migrations + RLS + repository tests pass.
  - _2026-11-19 (Module 4): demo-store collections `epics`, `stories` (append-only versions per code), `criteria`, `tasks`; links stored as codes (`FR-01`, `US-001`) until the Drizzle join tables land with PF-011/PF-012. Covered by `tests/integration/api/backlog.test.ts`._
- [x] **PF-034 — Story stage** · Depends on: PF-032, PF-033
  - Prompt `story.v1.md`; epics + stories in "As a / I want / so that" form, priority, dependencies, requirementIds.
  - Business rules: every story links ≥ 1 approved requirement; no dependency cycles.
  - **Done when:** eval coverage (requirements with ≥ 1 story) ≥ 90 % on fixtures.
  - _2026-11-19 (Module 4): `story` stage (`story.v1.md`) + demo engine. Fills coverage gaps only; rules, assumptions and answers that name no user attach to the story they constrain; rejection reasons and reviewer notes feed regeneration. `pnpm eval` backlog report: coverage 100 % (24/24) on the quick set, 5/5 valid. See ADR-014._
- [ ] **PF-035 — Split `components/prd/prd-workspace.tsx`** · Depends on: PF-031
  - 370 lines (CLAUDE.md asks for ~300): move the toolbar, Gate 2 panel and traceability panel into their own files.
  - **Done when:** every PRD component file is under 300 lines and the PRD browser test still passes.

## Week 4 — Criteria, tasks, traceability (MVP complete)

- [x] **PF-040 — QA stage** · Depends on: PF-034
  - Given/When/Then per story (positive, negative, edge), flags untestable/vague criteria.
  - **Done when:** every generated story has ≥ 2 criteria incl. ≥ 1 negative or edge case.
  - _2026-11-19 (Module 4): `qa` stage (`qa.v1.md`): positive, negative and edge case per story; linked rules become negative criteria; vague wording is flagged in the editor (`criterionFlags`). Eval: every story passes the rule._
- [x] **PF-041 — Task stage** · Depends on: PF-034
  - Technical tasks per story with estimate (hours) and suggested story points.
  - **Done when:** tasks saved and linked; estimates present.
  - _2026-11-19 (Module 4): `task` stage (`task.v1.md`): layered tasks (`TASK-001`…) with hours; Fibonacci story points from the total; a reviewer note can pin the points._
- [x] **PF-042 — Backlog manager (Gate 3)** · Depends on: PF-040, PF-041
  - Epic → story → criteria/tasks tree; approve / reject / edit; "regenerate with note".
  - **Done when:** only approved stories are exportable; actions audit-logged.
  - _2026-11-19 (Module 4): Backlog page — epics → story cards with autosaved story / criteria / tasks editors; approve (blockers listed), reject with a reason, restore, regenerate with note, edit an approved story as version n+1, add a story by hand, approve all ready, coverage and Gate 3 panels, Copy approved as Markdown. Every action is audit-logged. See ADR-014._
- [x] **PF-043 — Traceability view + coverage score** · Depends on: PF-042
  - `GET /api/projects/:id/traceability`; matrix requirement → stories → criteria → tasks; coverage % and gap list.
  - **Done when:** removing a story drops coverage and lists the orphaned requirement.
  - _2026-11-19 (Module 5): traceability page — matrix by requirement (PRD section → stories → criteria +/−/edge → tasks → 5-link trace chain → status) and by story; traceability score; gap list with severity and a link to each fix (`/backlog?story=US-003` opens the story); filters and search; CSV copy and download (formula-safe, audit-logged as `traceability.exported`). Rejecting a story drops the score and lists the requirement it left behind (`tests/integration/api/traceability.test.ts`, `e2e-trace`). See ADR-015._
- [x] **PF-044 — Business-rule validator module** · Depends on: PF-034
  - Central `src/ai/orchestrator/rules.ts`: orphan stories, missing criteria, dependency cycles, duplicate codes.
  - **Done when:** each rule has a unit test.
  - _2026-11-19 (Module 4): orphan stories, uncovered requirements, duplicate codes, unknown dependencies, dependency cycles, missing criteria, missing tasks, oversized tasks, vague criteria — each tested in `tests/unit/stories/rules.test.ts`._
- [ ] **PF-045 — Eval metrics v2** · Depends on: PF-028, PF-043
  - Add coverage, traceability, criterion testability, unsupported-claim checks.
  - **Done when:** report shows all metrics from PRD §Success metrics.

## Week 5 — Export and sprint planning

- [~] **PF-050 — Export** · Depends on: PF-042
  - `POST /api/projects/:id/exports/jira` → Jira-compatible CSV (Summary, Description, Issue Type, Priority, Story
    Points, Labels, and the edition's hierarchy columns: Issue ID + Parent for Jira Cloud — Epic Link was deprecated
    there in 2024 — or Epic Name + Epic Link + Issue Id/Parent Id for Jira Data Center) and JSON. Approved items only.
  - **Done when:** CSV imports into a Jira test project without errors.
  - _2026-11-19 (Module 6): Export page with edition choice, sub-task options, file preview, import guide and export history; CSV (Cloud / Data Center) and REST-shaped JSON; every export audit-logged, including PRD/backlog Markdown and traceability CSV. Both CSVs pass a checker for Atlassian's documented import rules (`tests/helpers/jira-csv-check.ts`). **Remaining:** a Jira admin imports the CSV into a company-managed Jira test project. See ADR-016._
- [x] **PF-051 — Sprints + capacity** (stretch) · Depends on: PF-033
  - `sprints` table; project settings for team capacity (points per sprint).
  - **Done when:** a PM sets velocity and the first sprint's start date, sees each sprint's dates and capacity, and
    can lower one sprint's capacity (holidays).
  - _2026-11-19 (Module 7): sprint settings (velocity, sprint 1 start; suggested 5 points per person per two weeks,
    next Monday), sprints with dates from the project's sprint length, per-sprint capacity and goal. A new velocity
    flows to sprints still at the old one. All changes audit-logged. See ADR-017._
- [x] **PF-052 — Sprint planner** (stretch) · Depends on: PF-041, PF-051
  - Allocation respecting priority, dependencies, capacity; drag-and-drop board.
  - **Done when:** the automatic plan never schedules a story before something it depends on, never goes over a
    sprint's capacity, and puts Must before Should before Could; stories can be moved by drag-and-drop or a
    keyboard-friendly "Move to" menu, and the board flags any dependency or capacity problem a move creates.
  - _2026-11-19 (Module 7): deterministic planner (not a model stage) with a reason on every placement; stories
    without points or with unapproved dependencies are held back with the reason; oversized stories get their own
    sprint and a "split it" flag; zero-capacity sprints are skipped. Sprint board with drag-and-drop, "Move to",
    new-sprint drop zone, "Not planned" column, capacity bars, suggested goals, forecast end date, warnings; re-plan
    keeps stories placed by hand (or plans from scratch). Placements are stored by story code, so approved stories
    are never changed. Planner unit tests + API integration tests + 12 browser checks. See ADR-017._
- [x] **PF-053 — Change impact** (stretch) · Depends on: PF-043
  - New requirement version → downstream items marked "Needs review"; AI explains likely impact; banner in sprint view.
  - **Done when:** changing, adding or withdrawing an approved requirement creates its next version (nothing is
    edited in place); before approval the PM sees every affected PRD line, story, criterion, task and sprint
    placement with an explanation; after approval each affected item shows "Needs review" (backlog, PRD,
    traceability, export, sprint board) and blocks Gate 3 until it's updated or marked reviewed.
  - _2026-11-19 (Module 8): change requests CR-01… (change wording, add, withdraw) with a reason; affected items
    found by rules from the requirement links, explained and rated by a new `impact` stage (prompt v1, demo engine,
    business rules: only listed items, every story and the PRD explained); approve creates the requirement's next
    version, discard leaves everything as it was; "Needs review" is derived and clears when the item gets a new
    version, is rejected, or is marked reviewed (with an optional note). Changes page, banners on backlog / PRD /
    sprint board, gaps in traceability, export warning, project card, activity. Open questions can now be answered
    after Gate 1 through a change. Impact eval added (`tests/ai-evals/impact.eval.ts`). See ADR-018._
- [ ] **PF-054 — Two-step Jira import fallback** · Depends on: PF-050
  - Some Jira Cloud sites (2026 reports) don't link stories to epics created in the same CSV. Offer an "epics
    first" file, then a children file whose Parent column holds the epic keys the PM pastes back in.
  - **Done when:** both files import into a Jira test project and every story shows its epic.
- [ ] **PF-056 — Requirement history view** · Depends on: PF-053
  - On the discovery page, show each requirement's versions side by side (v1 → v2 wording, evidence, the change
    request and reason), like the PRD's version compare.
  - **Done when:** every requirement with more than one version can be compared, and each version links its CR.
- [ ] **PF-055 — Sprint close-out and measured velocity** (stretch) · Depends on: PF-052
  - Close a sprint (done / carried over), move unfinished stories to the next sprint, and suggest velocity from the
    average of the last three closed sprints instead of the 5-points-per-person starting rule (ADR-017).
  - **Done when:** after two closed sprints the suggested velocity is their measured average, and carried-over
    stories keep their place at the top of the next sprint.

## Week 6 — Quality and launch

- [ ] **PF-060 — E2E test** · Depends on: PF-050
  - Playwright: sign up → project → discovery → clarify → PRD → backlog → export (model mocked).
- [ ] **PF-061 — Role permissions** · Depends on: PF-042
  - Only Owner/Admin/PM approve; Developer/QA edit drafts and comment. Tests per role.
- [ ] **PF-062 — Rate limits + cost caps** · Depends on: PF-021
  - Per-workspace request limit and monthly token budget; clear error when exceeded.
- [ ] **PF-063 — Full eval report** · Depends on: PF-045
  - Run all fixtures; save `docs/EVAL_REPORT.md` with results against targets.
- [ ] **PF-064 — Production deploy + demo seed** · Depends on: PF-016, PF-060
  - Seeded demo project (transaction monitoring dashboard).
  - Needs every module's data in Postgres first (the file store needs a writable disk). Then: Supabase variables in
    Vercel's Production environment, production callback in Supabase redirect URLs as `https://<host>/auth/callback?**` (set by hand, not the
    Vercel integration), remove
    `git.deploymentEnabled.main = false` from `vercel.json`, branch protection on `main` (ADR-025).
- [ ] **PF-065 — README + demo** · Depends on: PF-064
  - README with screenshots, architecture diagram, eval results; 3–5 min demo script and recording.
- [ ] **PF-066 — Major dependency upgrades** · Depends on: PF-016
  - vitest 4 → 5, postgres (driver) 3 → 4, @vitejs/plugin-react 5 → 6: Dependabot skips majors (ADR-025), so each is
    upgraded on its own branch, with release notes read and CI green.
  - **Done when:** all three are on their current major with `pnpm test`, `pnpm build` and `pnpm db:audit` passing.

---

- [ ] **PF-067 — Verify the database's certificate** · Depends on: PF-018
  - Connect with `verify-full` against Supabase's root CA (downloaded from the project's database settings and
    shipped with the app) instead of `require`, so a machine pretending to be the database is refused.
  - **Done when:** the app and `db:*` scripts connect with certificate checks on; a wrong CA fails clearly.

## Week 7 — Data into Postgres

Every module moves from the demo store to Postgres behind its existing repository interface (ADR-022), as the
signed-in user so RLS applies, with PGlite tests of the real services. Order follows the data's dependencies.

- [x] **PF-070 — Discovery data in Postgres** · Depends on: PF-015
  - Tables `requirements` (versioned; approved rows immutable in the database), `clarifying_questions`, `discoveries`,
    `source_documents`, with RLS matching the product rules: members read and edit drafts, owners/admins/PMs run
    discovery and approve.
  - A discovery run (replace AI drafts, add requirements with codes, refresh open questions, save the summary) is one
    transaction.
  - **Done when:** discovery → answer questions → confirm works with `DATA_DRIVER=postgres`; repository + RLS tests pass.
  - *2026-11-20:* code and tests done (ADR-026; PGlite `discovery-data.test.ts` 7/7). Migration 0004 applied to Mumbai;
    CI green on PR #4; clicked through on Mumbai: brief → discovery (12 requirements, 10 questions) → answer / assume /
    skip → Gate 1 (12 approved, survives reload) → PRD generated covering 12/12.
- [x] **PF-071 — AI run log and idempotency in Postgres** · Depends on: PF-070
  - `agent_runs`, `idempotency_records`; `agent_run_id` columns become foreign keys.
  - **Done when:** every stage run is logged in Postgres and a repeated `Idempotency-Key` returns the first result.
  - *2026-11-20:* code and tests done (ADR-027; PGlite `agent-runs-data.test.ts` 8/8): run log, one running run per
    stage, idempotency records, run foreign keys (`NOT VALID` for older rows). PR #6 merged with green CI; 0005 applied to
    Mumbai; checked in Chrome on Mumbai: two simultaneous runs → one ran, the other 409 "already running";
    the same Idempotency-Key twice → one run, second replayed; discovery and PRD runs logged with tokens and steps.
- [~] **PF-072 — PRDs in Postgres** · Depends on: PF-070, PF-071
  - `prds` (versions, JSONB sections), approved versions immutable.
  - **Done when:** generate → edit → approve (Gate 2) works with `DATA_DRIVER=postgres`.
  - *2026-11-20:* code and tests done (ADR-028; PGlite `prd-data.test.ts` 7/7). Left: CI, `db:migrate` on Mumbai,
    a click-through.
- [ ] **PF-073 — Backlog in Postgres** · Depends on: PF-072 (absorbs PF-033)
  - `epics`, `stories` (versioned), `story_requirements`, `story_dependencies`, `acceptance_criteria`, `tasks`.
  - **Done when:** backlog generation, review (Gate 3) and traceability work with `DATA_DRIVER=postgres`.
- [ ] **PF-074 — Sprints, exports and change requests in Postgres** · Depends on: PF-073
  - **Done when:** sprint planning, Jira export and requirement changes work with `DATA_DRIVER=postgres`.
- [ ] **PF-075 — Postgres-only mode** · Depends on: PF-074
  - With `DATA_DRIVER=postgres` nothing touches the file store; demo mode keeps it.
  - Validate the `agent_run_id` foreign keys added `NOT VALID` in PF-071 (clear pre-PF-071 test data first).
  - **Done when:** the app runs with a read-only file system (unblocks PF-064).

## Later (not scheduled)

- Jira API sync · team collaboration / comments · duplicate-story detection (embeddings) · release notes ·
  domain templates · analytics · queue worker for long jobs (Redis/BullMQ)
