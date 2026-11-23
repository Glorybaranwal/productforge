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
- [x] **PF-003 — Domain Zod schemas** · Depends on: PF-001
  - `Evidence`, `ArtifactStatus`, `Requirement`, `ClarifyingQuestion`, `Prd` (+ sections), `Epic`, `UserStory`,
    `AcceptanceCriterion`, `TechnicalTask`, `Sprint` in `src/modules/*/schema.ts`.
  - Story requires `requirementIds.min(1)` and `acceptanceCriteria.min(2)`.
  - **Done when:** unit tests pass for one valid and two invalid samples per schema.
  - *2026-11-20:* `tests/unit/schemas/domain.test.ts` (24 cases: Requirement, ClarifyingQuestion, Prd, Epic, Story,
    AcceptanceCriterion, TechnicalTask, Sprint). Stories link ≥ 1 requirement in the schema; "≥ 2 criteria" is a
    backlog rule (PF-044), since criteria are their own rows.
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
  - *2026-11-22:* raised to a **launch blocker**, second only to PF-064: until this is done the only people who
    can sign up are the Supabase project's own team, at a few emails an hour, and a link opened in a different
    browser than the one that asked for it fails. Mostly dashboard work (custom SMTP + the template); the
    callback already accepts `token_hash`.
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
- [x] **PF-019 — Nonce-based CSP** · Depends on: PF-013
  - Replace `'unsafe-inline'` scripts with per-request nonces set in `proxy.ts` (ADR-023).
  - **Done when:** the CSP has no `'unsafe-inline'` for scripts and every page still works.
  - *2026-11-20:* per-request nonce from `proxy.ts`, `'strict-dynamic'`, no `'unsafe-inline'` for scripts (ADR-032).
    Checked in Chrome on every project page: no CSP violations, client code works.

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
- [x] **PF-023 — Document upload + extraction** · Depends on: PF-015
  - PDF/DOCX/TXT ≤ 10 MB, MIME check, Supabase Storage, text extraction server-side, `source_documents` table.
  - **Done when:** an uploaded PDF's text is stored and visible in the project.
  - *2026-11-20:* server-side extraction (ADR-033): PDF (`unpdf`), .docx (`mammoth`), text; checks before parsing
    (type sniffing, 10 MB, 50 pages, zip-bomb pre-check); only text stored. 9 extraction tests with real files.
    Checked on Mumbai in Chrome: a 2-page PDF uploaded (201, text stored as a source, listed on the page); a fake
    PDF refused (400 "This file isn't a PDF").
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
- [x] **PF-027 — SSE progress** · Depends on: PF-022
  - `GET /api/projects/:id/runs/live?stages=…` (SSE; per project, not per run — see ADR-034); UI shows stage progress and errors.
  - **Done when:** progress events appear in the UI during a run.
- [x] **PF-028 — Eval runner v1** · Depends on: PF-004, PF-024
  - `pnpm eval` runs discovery on all fixtures; reports schema validity, question count, expected-requirement recall.
  - Two-tier scoring, `mustNotInvent` check, token cap and path-filtered CI job per ADR-010.
  - **Done when:** report written to `tests/ai-evals/reports/<date>.md`.
  - _2026-11-19 (Module 2): `pnpm eval` / `pnpm eval:quick` (Vitest config `vitest.eval.config.mts`) write `tests/ai-evals/reports/<date>-discovery-<provider>.md` with ADR-010 Tier 1 scores. Tier 2 judge → PF-029._

- [x] **PF-029 — Eval Tier 2 judge** · Depends on: PF-028
  - LLM judge for expected items Tier 1 missed (ADR-010): `tests/ai-evals/judge.v1.md`, temperature 0, JSON verdict.
  - **Done when:** full `pnpm eval` reports which tier matched each item.
  - _2026-11-22: `tests/ai-evals/judge.ts` + `judge.v1.md`; full runs on a real provider judge the Tier 1 misses (one call per fixture and list) and the report lists the tier per expected item; quick and demo runs skip Tier 2._

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
- [x] **PF-033 — Epics & stories tables** · Depends on: PF-011
  - `epics`, `user_stories` (versioned), `story_requirements`, `story_dependencies`.
  - **Done when:** migrations + RLS + repository tests pass.
  - _2026-11-19 (Module 4): demo-store collections `epics`, `stories` (append-only versions per code), `criteria`, `tasks`; links stored as codes (`FR-01`, `US-001`) until the Drizzle join tables land with PF-011/PF-012. Covered by `tests/integration/api/backlog.test.ts`._
- [x] **PF-034 — Story stage** · Depends on: PF-032, PF-033
  - Prompt `story.v1.md`; epics + stories in "As a / I want / so that" form, priority, dependencies, requirementIds.
  - Business rules: every story links ≥ 1 approved requirement; no dependency cycles.
  - **Done when:** eval coverage (requirements with ≥ 1 story) ≥ 90 % on fixtures.
  - _2026-11-19 (Module 4): `story` stage (`story.v1.md`) + demo engine. Fills coverage gaps only; rules, assumptions and answers that name no user attach to the story they constrain; rejection reasons and reviewer notes feed regeneration. `pnpm eval` backlog report: coverage 100 % (24/24) on the quick set, 5/5 valid. See ADR-014._
- [x] **PF-035 — Split `components/prd/prd-workspace.tsx`** · Depends on: PF-031 · Done 2026-11-22: toolbar, Gate 2 and traceability panels moved to their own files.
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
- [x] **PF-056 — Requirement history view** · Depends on: PF-053
  - On the discovery page, show each requirement's versions side by side (v1 → v2 wording, evidence, the change
    request and reason), like the PRD's version compare.
  - **Done when:** every requirement with more than one version can be compared, and each version links its CR.
  - 2026-11-22: done — `GET /api/projects/:id/requirements/history`, word diff, "Compare versions" on the discovery page.
- [ ] **PF-055 — Sprint close-out and measured velocity** (stretch) · Depends on: PF-052
  - Close a sprint (done / carried over), move unfinished stories to the next sprint, and suggest velocity from the
    average of the last three closed sprints instead of the 5-points-per-person starting rule (ADR-017).
  - **Done when:** after two closed sprints the suggested velocity is their measured average, and carried-over
    stories keep their place at the top of the next sprint.

## Week 6 — Quality and launch

- [~] **PF-060 — E2E test** · Depends on: PF-050
  - Playwright: sign up → project → discovery → clarify → PRD → backlog → export (model mocked).
  - *2026-11-20:* Playwright config (demo mode, port 3100) + J1 (project, dumb-user and CSP checks) and J2
    (discovery) specs written. *2026-11-22:* `@playwright/test` 1.65.1 added; J1 + J2 pass on the developer's Mac
    (`pnpm test:e2e`, demo mode). Left: J3–J8 from the test plan.
- [x] **PF-061 — Role permissions** · Depends on: PF-042
  - Only Owner/Admin/PM approve; Developer/QA edit drafts and comment. Tests per role.
  - *2026-11-20:* `route-matrix.test.ts` calls every write route as Developer and QA: 403 except the 9 member
    writes the ADRs allow (sources, drafts, answers, PRD draft version, export). Same test: another workspace
    gets 400/404 on every route with this workspace's ids and sees none of them (ADR-035).
- [x] **PF-062 — Rate limits + cost caps** · Depends on: PF-021
  - Per-workspace request limit and monthly token budget; clear error when exceeded.
  - *2026-11-20:* checked before every AI run from the run log (works across servers): 12 runs per user per
    minute, 2M tokens per workspace per UTC month, both from env; 429 `RATE_LIMITED` with the reason. Live
    views capped at 5 per user per server (ADR-035).
- [ ] **PF-063 — Full eval report** · Depends on: PF-045
  - Run all fixtures; save `docs/EVAL_REPORT.md` with results against targets.
- [ ] **PF-064 — Production deploy + demo seed** · Depends on: PF-016, PF-060
  - Seeded demo project (transaction monitoring dashboard).
  - *2026-11-22:* seed done: `pnpm db:seed -- --email <user>` (needs `DATA_DRIVER=postgres`; `src/modules/projects/demo-seed.ts`, idempotent, demo engine).
  - *2026-11-22:* config and runbook done (`docs/DEPLOY.md`; `vercel.json` no longer blocks `main` deploys). Left: the owner's steps in that guide, then the smoke test. The task stays open until then.
  - *2026-11-22 (whole-branch review, 0 Critical / 4 Important):* fixed — the seed could not run at all under
    `tsx` (top-level `await` in a CommonJS package forces ESM, and Next 16 ships no `exports` field, so the
    `next/headers` import reached through `workspaces/service` could not resolve): the body now runs inside
    `main()` and `getSession` is imported lazily, which takes `next/headers` out of the script's module graph
    altogether. Also fixed: the rollback step pointed at a deployment that 500s, the smoke test was silent about
    PF-017, step 7 under-stated `.env.local`, step 2 omitted `db:audit`, and the PRD approval on resume picked
    the oldest version.
  - *2026-11-22 (both open findings closed on the developer's Mac):* `corepack pnpm install --frozen-lockfile`
    succeeded, so the hand-edited `tsx` lockfile entry is valid and CI will not block the pull request.
    `corepack pnpm db:seed` with no arguments printed its usage line and stopped — static imports resolve
    before `main()` runs, so that message proves the whole 115-file module graph loads under `tsx`, which is
    the thing that could not be checked in Claude's VM (Linux arm64 against darwin-arm64 esbuild binaries).
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
- [x] **PF-072 — PRDs in Postgres** · Depends on: PF-070, PF-071
  - `prds` (versions, JSONB sections), approved versions immutable.
  - **Done when:** generate → edit → approve (Gate 2) works with `DATA_DRIVER=postgres`.
  - *2026-11-20:* code and tests done (ADR-028; PGlite `prd-data.test.ts` 7/7). Checked on Mumbai in Chrome: generate
    → edit (ai_edited) → approve → edit refused (409) → v2 from v1, asking again returns the same draft.
- [x] **PF-073 — Backlog in Postgres** · Depends on: PF-072 (absorbs PF-033)
  - `epics`, `stories` (versioned), `story_requirements`, `story_dependencies`, `acceptance_criteria`, `tasks`.
  - **Done when:** backlog generation, review (Gate 3) and traceability work with `DATA_DRIVER=postgres`.
  - *2026-11-20:* code and tests done (ADR-029; PGlite `backlog-data.test.ts` 8/8). Requirement and story links
    stay code arrays instead of join tables. Checked on Mumbai in Chrome: generate (9 stories, 25 criteria,
    35 tasks) → approve 9 (Gate 3 passed) → editing an approved story refused (409) → v2 copies its criteria and
    tasks → traceability 98. First page after a restart hit CONNECT_TIMEOUT again: the connection now retries once.
- [x] **PF-074 — Sprints, exports and change requests in Postgres** · Depends on: PF-073
  - **Done when:** sprint planning, Jira export and requirement changes work with `DATA_DRIVER=postgres`.
  - *2026-11-20:* code and tests done (ADR-030; PGlite `planning-data.test.ts` 9/9). Exports were already audit
    entries in Postgres. Fixed: approving a change wrote the approver's name into `requirements.approved_by` (uuid).
    Checked on Mumbai in Chrome: settings + plan + move out/in (stories depending on a draft held back, as
    designed); CR-01 proposed → approved (FR-08 v2, approver stored as user id) → second approve 409 → review
    mark saved; Changes page renders from Postgres.
- [x] **PF-075 — Postgres-only mode** · Depends on: PF-074
  - With `DATA_DRIVER=postgres` nothing touches the file store; demo mode keeps it.
  - Validate the `agent_run_id` foreign keys added `NOT VALID` in PF-071 (clear pre-PF-071 test data first).
  - **Done when:** the app runs with a read-only file system (unblocks PF-064).
  - *2026-11-20:* demo store refused when `DATA_DRIVER=postgres` (ADR-031); all Postgres-mode integration tests
    pass with the guard on; migration 0009 clears pre-PF-071 run links and validates the run foreign keys.
  - *2026-11-22:* checked on Mumbai with `DATA_DRIVER=postgres` after `db:migrate` + `db:check` passed: all 10 pages
    and 12 read endpoints answer 200 with no errors; a new project → source → discovery run (demo engine) works, with
    the live progress stream showing all 6 steps; `.data/productforge.json` unchanged (same mtime and size), so nothing
    touched the file store. Requirement history (PF-056) shows FR-08 v1 → v2 with CR-01 on real data.

## Week 8 — Hardening (from the test plan, 2026-11-20)

- [x] **PF-076 — Log redaction** · Depends on: PF-005
  - The logger masks secret-named keys and credential-shaped values, cuts strings over 300 chars, reduces errors
    to name + message.
  - **Done when:** unit tests show keys, JWTs and long document text never reach a log line.
- [x] **PF-077 — Architecture lint rules** · Depends on: PF-001
  - ESLint: route handlers can't import repositories, the DB, stages or `openai`; UI can't import `src/ai`
    (except the pure rule checkers) or the DB; files over 300 lines warn. Two routes moved to a run service.
  - **Done when:** `pnpm lint` fails on a client file importing the LLM client.
- [ ] **PF-078 — Rotate secrets before real data** **(ask first)** · Depends on: —
  - Rotate the Supabase secret key, DB password and OpenAI key pasted in chat earlier (SEC-21); update
    `.env.local` and Vercel. Done by the user in the dashboards.
  - **Done when:** old keys are revoked and the app still signs in and runs discovery.
- [ ] **PF-080 — Minor findings from the UI and tests review (2026-11-22)** · Depends on: —
  - `app/dashboard/layout.tsx` disables `no-restricted-imports` to read `dataBackend()` from `src/db/scope`:
    expose it from `src/lib` (next to `authDriver`) and drop the suppression.
  - Add `expect(arr.length).toBeGreaterThan(0)` before each `.every(...)` in discovery-data, planning-data and
    backlog-data tests (an empty array passes vacuously).
  - The `*-data.test.ts` files depend on earlier `it`s (`changeId`, approvals): move shared setup to `beforeAll`
    or make each `it` build its own prerequisites, so `-t` and `.only` work.
  - `tests/unit/ai/budget.test.ts` and `route-matrix.test.ts` delete `AI_RUNS_PER_USER_PER_MINUTE` in `afterEach`:
    use `vi.stubEnv` and `vi.unstubAllEnvs()` so a value set by CI or `.env` is restored.
  - Tests still missing from the review: an inflating-entry zip test (header lies low, data is huge) and a
    prompt-injection test that source text stays inside the untrusted-data block; the `onFile` upload path in
    `sources-panel.tsx` (sends `FormData`).
  - **Done when:** each item above is done or has a reason noted here.

- [ ] **PF-081 — Deferred minors from the final review (2026-11-22)** · Depends on: —
  - `run-progress.test.ts:74`: `slice(lastIndexOf + 2)` misbehaves when there is no frame boundary (latent, can only cause a false failure).
  - `run-progress.test.ts:59`: the `started` promise is not awaited.
  - The `empty:hidden` wrapper never hides now (cosmetic, a few px).
  - `word-diff`: add tests for repeated words and punctuation.
  - History panel refetches on every reopen (acceptable; cache if it shows up in traces).
  - Judge: keep the "judge output invalid" reason for non-matches instead of reporting "missed".
  - Extract `tier2Status()` from `discovery.eval.ts` (QUICK/demo gating) and test it.
  - Add tests for the judge's phrase/index fallback paths.
  - ADR-010 token cap: add `EVAL_TOKEN_CAP` or correct the ADR, once the user decides.
  - **Done when:** each item above is done or has a reason noted here.

- [x] **PF-082 — Eval token cap** · Depends on: PF-029
  - ADR-010's cost guard: one `EVAL_TOKEN_CAP` for a whole `pnpm eval` run, shared by every eval file; stops before
    the next model call once reached, reports what ran, then fails with how to raise it. Demo engine uncapped.
  - **Done when:** unit tests show the cap refuses the next call, holds across two eval files, and the report states
    usage and an early stop.
  - *2026-11-22:* built (`tests/ai-evals/token-cap.ts`, `global-setup.ts`); 11 unit tests, red-green checked.

- [ ] **PF-085 — `db:seed` hardening and tests** · Module 1 (projects) · branch `m1-seed-tests` ·
      Depends on: PF-064
  - From the PF-064 whole-branch review. The seed is exercised only in store mode and `scripts/db-seed.ts` has no
    test of its own, which is why a script that could not load passed every check.
  - A test for `scripts/db-seed.ts` itself (argument parsing, the `DATA_DRIVER` refusal, the unknown-email
    message) and one that imports it in a child process, so a module-resolution break fails a test rather than a
    deploy.
  - Tests for step-name wrapping and `AppError` code preservation when a step throws.
  - Exclude `REJECTED` stories from the backlog need-check, so a project with rejected stories stops re-running it.
  - Cover the resume branches that have no test: a PRD draft with no approval, and stories with no sprints.
  - **Done when:** each item above is done or has a reason noted here, and one test fails if the seed script
    stops loading.

## Week 9 — Access control and abuse limits (2026-11-22)

> Why now: the pipeline is built and all of its data is in Postgres, so the remaining work is making the public
> URL safe to hand out. See ADR-036. Each task below is one module, one branch, one pull request.

- [ ] **PF-083 — API keys for service-to-service calls** · Module 0 (platform) · branch `m0-api-keys` ·
      Depends on: PF-013, PF-015
  - Browsers keep their Supabase JWT session (ADR-021); anything that is not a browser authenticates with a
    workspace API key, and **every key acts as the member who created it**, so no policy changes (ADR-036).
  - `api_keys` table + RLS + migration 0010: `workspace_id`, `user_id` (issuer), `name`, `prefix`, `secret_hash`,
    `scope`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`. The plaintext key is shown once and never
    stored; only a SHA-256 hash and the non-secret `prefix` (for display and log correlation) are kept.
  - *2026-11-23:* data layer done (`src/db/schema/api-keys.ts`, migration 0010, `src/modules/api-keys/`,
    PGlite policy tests). One `scope` per key, not a list: write subsumes read, and no scope approves.
    `expires_at` is mandatory and the table caps it at 366 days.
  - *2026-11-23:* verify path and enforcement done (`src/lib/api-key.ts`, `src/lib/request-key.ts`,
    `src/modules/api-keys/service.ts`, the gate, `currentContext`, both routes). Enforcement is by HTTP
    method, not by role: see the ADR-036 follow-up — member writes have no role check, so the ceiling alone
    could not hold a `read` key to reads.
  - *2026-11-23:* **done.** Settings screen, audit trail and architecture note finished; whole-branch review
    READY WITH FIXES (0 Critical), all three Important fixed: the route matrix now calls all 35 mutating routes
    with a `read` key and asserts 403 with the scope's own message; first use writes an `api_key.first_used`
    audit row (reads are not audited, so `last_used_at` alone left no trace a key had gone live); and a refused
    key is told *why* once it has proved possession of the secret, while the three pre-authentication failures
    stay byte-identical. See the two ADR-036 follow-ups. **Not run anywhere:** every test on the branch is
    unexecuted (vitest cannot start in Claude's VM) and nobody has seen the settings page render.
  - `src/modules/api-keys/{schema,service,repository,store-repository,pg-repository}.ts` in the usual shape.
  - `src/lib/auth-key.ts`: `Authorization: Bearer pf_…` → prefix lookup → constant-time hash compare → expiry and
    revocation check → membership re-read → context via the existing `actAs(user_id)` path, with the key's
    effective role the **lower** of its scope and the member's current role. Touches `last_used_at`.
  - Scopes are `read` and `write` only. A key is refused (403) on every approve/confirm route whatever its owner's
    role, because approval is a human action (CLAUDE.md §7.7).
  - On `/api/*` a bearer key authenticates the request and the cookie is ignored; `/dashboard/*` never accepts a key.
  - Settings → API keys: create (name, scope, expiry), the key shown once, list with prefix and last used, revoke.
  - Audit entries for create, revoke and first use. `docs/ARCHITECTURE.md` gains the auth model section.
  - **Done when:** a key made in the UI reads `GET /api/projects` from `curl`; the same key is refused on an
    approve route, after revocation, after expiry, and once its member is removed from the workspace; the route
    matrix test calls every write route with a `read` key and gets 403; no test or log line ever contains a
    plaintext key.

- [ ] **PF-086 — PF-083 follow-ups from the final review** · Module 0 (platform) · branch `m0-api-key-polish` ·
      Depends on: PF-083
  - The eleven minors the whole-branch review triaged to backlog, none of which block the merge:
    column-level `SELECT` grant so `secret_hash` never rides along on a `select *` (needs
    `pg-repository.ts`'s three `select *` calls turned into explicit column lists first); the PGlite suite's
    exact-count assertions and shared-database ordering; `expectRlsRefusal` accepting any 42501 so a policy
    denial and a missing column privilege look alike; the non-atomic `refreshEpics` backstop; the 490-line
    `api-keys.test.ts`; four Task 3 test gaps (revoked rows keeping no Revoke button, the plaintext on a second
    create and on unmount, the empty-state wording); client-clock expiry refusing 366 days when the clock runs
    ahead; `ownerLabel`'s dead branch; and date hydration.
  - **A key shares its owner's 5-open-stream cap** on `GET /api/projects/:id/runs/live`, so a busy key can lock
    the human out of their own dashboard. **Done in PF-084** by re-keying the cap on the principal; it stays a
    concurrency cap and is not folded into the counters (ADR-037).
  - **Member names:** an owner or admin sees another member's key as `Member <first 8 of userId>`, because no
    member directory exists. Needs a backend lookup before the UI can show a name.
  - **Done when:** each item is done or has a reason noted here.

- [ ] **PF-087 — Let the Jira sync use a read key** · Module 5 (sprint & export) · branch `m5-export-read-key` ·
      Depends on: PF-083
  - ADR-036 names the Jira sync as a motivating case for API keys, but it cannot use a `read` key: generating
    the export is `POST /api/projects/:id/exports/jira` (it takes options in a body), and enforcement is by HTTP
    method, so a POST demands `write`. Generating an export file reads data and changes none.
  - Two routes out, neither free: exempt that path from the method rule, which weakens the one invariant all
    enforcement rests on; or offer a GET form that takes its options as query parameters, leaving the POST alone.
  - Until then the sync runs with a `write` key — over-privileged for what it does, though still capped at its
    owner's role and still unable to approve anything.
  - **Done when:** the Jira export can be driven by a `read` key, or this is closed with the reason recorded.

- [ ] **PF-084 — HTTP rate limits and `Retry-After`** · Module 0 (platform) · branch `m0-rate-limit` ·
      Depends on: PF-083
  - Today only AI runs, sign-in and live views are metered (PF-062); the other 42 routes are not, and no 429
    anywhere sets a `Retry-After` header, so a well-behaved client cannot back off.
  - `src/lib/rate-limit.ts`: fixed-window counters in Postgres keyed by principal (user id or API key id) and route
    class, with the limits in env. Postgres rather than memory because Vercel runs many instances and the AI budget
    already proved the pattern (ADR-035).
  - Route classes and starting limits: upload 10/min, export 20/min, generate 12/min (on top of the run budget),
    other writes 60/min, reads 240/min.
  - Unauthenticated paths (`/login`, `/auth/*`) get a per-IP guard in `proxy.ts`: in-memory, per-instance and
    therefore approximate — a speed bump in front of Supabase's own sign-in limit, not the real control.
  - `errorResponse` sets `Retry-After` on every `RATE_LIMITED` response, including the existing AI budget 429.
  - **Done when:** a unit test shows a window counting and resetting; an integration test gets 429 with a
    `Retry-After` header on the 11th upload inside a minute; two separate contexts share one counter (PGlite);
    the AI budget's 429 carries the header.
  - *2026-11-23:* counter done (ADR-037): `rate_limit_hits` + migration 0011 + `src/lib/rate-limit.ts`,
    admin-written with every grant revoked, a one-statement upsert (25 concurrent calls → exactly 10 allowed),
    failing open with `logger.error`, and `Retry-After` on every `RATE_LIMITED` — including the AI budget's
    monthly 429, which had been inheriting a misleading 60 seconds when that budget resets on the 1st.
    Left: classifying each request and applying the limit (Task 2).
  - Follow-up noted, not in scope: the live-view cap stays an in-memory **concurrency** cap, re-keyed by
    principal so a key no longer consumes its owner's five slots. It is deliberately *not* moved onto the
    counters: a fixed-window counter counts opens per minute, which is not what that cap means (ADR-037).
  - Follow-up: a pool-level `statement_timeout` on the admin client in place of the 2 s client-side race, so an
    abandoned counter query cannot retain its pooled connection. Needs a run to see what a cap would do to
    `db:audit` and `db:check`, which share that pool.

## Later (not scheduled)

- Jira API sync · team collaboration / comments · duplicate-story detection (embeddings) · release notes ·
  domain templates · analytics · queue worker for long jobs (Redis/BullMQ)
