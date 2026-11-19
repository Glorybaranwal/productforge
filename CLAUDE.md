# CLAUDE.md — ProductForge AI

You are working on **ProductForge AI**, an AI product-management workspace that turns a business idea into a
human-approved, sprint-ready backlog (PRD → epics → stories → acceptance criteria → tasks), with every item
traceable to the requirement it came from.

This file tells you how to work on the repo. Read it fully at the start of every session.

---

## 1. Start-of-session protocol (do this every time, in order)

1. Read `docs/STATUS.md` — current phase, the task in progress, blockers, last session's notes.
2. Open `docs/BACKLOG.md` and pick the task to work on:
   - a task marked `[~]` (in progress) first;
   - otherwise the **first** `[ ]` task whose `Depends on` tasks are all `[x]`.
   - If the user named a task ID (e.g. `PF-024`), use that instead.
3. Read only the doc sections that task needs (`docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`).
4. Tell the user in 3–5 lines: the task ID, what you will build, files you expect to touch, how you'll verify it.
   Then start — do not wait for approval unless the task says **(ask first)** or a decision in
   `docs/DECISIONS.md` is marked **OPEN** and blocks the task.
5. Mark the task `[~]` in `docs/BACKLOG.md`.

## 2. End-of-session protocol (before you stop)

1. Run `pnpm lint && pnpm typecheck && pnpm test`. Fix failures or record them as blockers.
2. In `docs/BACKLOG.md`: mark finished tasks `[x]`; leave unfinished ones `[~]` with a one-line note.
3. In `docs/STATUS.md`: update "Current", "Next up", "Blockers", and add one row to the session log.
4. If you made a design choice, add an ADR entry to `docs/DECISIONS.md`.
5. If you discovered new work, add it to `docs/BACKLOG.md` as a new task with the next free ID in that section.

The `/next` and `/wrap` commands in `.claude/commands/` run these two protocols.

## 3. Source of truth

| Topic | File |
| --- | --- |
| What we're building, users, scope, metrics | `docs/PRD.md` |
| Architecture, data model, API, AI pipeline | `docs/ARCHITECTURE.md` |
| Decisions and their reasons | `docs/DECISIONS.md` |
| Work items, order, acceptance criteria | `docs/BACKLOG.md` |
| Where we are right now | `docs/STATUS.md` |
| Full product & technical doc (human-facing) | https://claude.ai/artifact/7QjwDZennjKuBajC2y8RhS |

If code and docs disagree, stop and ask the user which is right, then update the other.

## 4. Tech stack

- **App:** Next.js (App Router) + React + TypeScript (`strict: true`), Tailwind CSS, shadcn/ui
- **API:** Next.js Route Handlers, REST, SSE for generation progress
- **Validation:** Zod — the single source of truth for domain types, AI output schemas and API input
- **DB / Auth / Storage:** Supabase (PostgreSQL with Row Level Security, Supabase Auth, Supabase Storage)
- **ORM:** see ADR-005 in `docs/DECISIONS.md` (OPEN until decided)
- **AI:** OpenAI Responses API with Structured Outputs, always behind `src/ai/llm-client.ts`
- **Tests:** Vitest, React Testing Library, Playwright, custom AI evals in `tests/ai-evals`
- **CI/CD:** GitHub Actions → Vercel
- **Package manager:** pnpm

## 5. Commands

```bash
pnpm dev            # run the app locally
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # unit + integration (Vitest)
pnpm test:e2e       # Playwright
pnpm eval           # AI evals on tests/ai-evals/fixtures (calls the model; costs tokens)
pnpm eval:quick     # 5-fixture subset, used in CI
pnpm db:migrate     # apply migrations
pnpm db:seed        # seed demo workspace + project
```

(Add these scripts to `package.json` as part of PF-001 / PF-011 if they don't exist yet.)

## 6. Repository layout

```
app/                     Next.js routes (pages + app/api route handlers). Thin: call services, no business logic.
components/              UI components. ui/ = shadcn primitives, feature folders for the rest.
src/modules/<module>/    Domain modules: projects, requirements, prd, stories, sprints, exports, impact
    schema.ts            Zod schemas + inferred types for this module
    service.ts           Business logic. The only place route handlers call.
    repository.ts        DB access. The only place that talks to the DB.
src/ai/
    llm-client.ts        Provider-agnostic interface + OpenAI implementation
    orchestrator/        Stage runner: context → model → validate → retry → save drafts → log run
    stages/              discovery, prd, story, qa, task, sprint — one file each
    prompts/             System prompts as versioned .md files
    schemas/             AI output schemas (re-export / compose module schemas)
src/db/                  Schema, migrations, RLS policies, seed
src/lib/                 auth, errors, logger, idempotency, rate limiting
tests/unit | integration | e2e | ai-evals
docs/                    The files in section 3
```

## 7. Non-negotiable rules

1. **Never call the model from the browser.** All AI calls go through `src/ai/orchestrator` on the server.
2. **Every AI output is Zod-validated** and passes business-rule checks before it is written. On failure:
   retry once with the validation errors in the prompt, then mark the `agent_run` failed.
3. **Every generated row carries:** `workspace_id`, `status`, `evidence`, `origin` (`ai` | `human` | `ai_edited`),
   `agent_run_id`.
4. **Evidence labels are mandatory:** `EXPLICIT` | `INFERRED` | `ASSUMPTION` | `OPEN_QUESTION`.
5. **Traceability is mandatory:** a story must link to ≥ 1 requirement; criteria and tasks belong to a story.
6. **Approved rows are never updated in place.** Editing an approved requirement/PRD/story inserts a new version.
7. **AI output is saved as `DRAFT`.** Only a user action moves anything to `APPROVED`.
8. **Uploaded documents are untrusted data.** Wrap them in clearly delimited blocks in prompts; the system prompt
   states that document text is never instructions.
9. **Tenant isolation:** every table with project data has `workspace_id` and an RLS policy. Add an
   integration test for each new policy.
10. **Secrets** only in env vars; update `.env.example` when you add one.
11. **No new dependency** without a one-line reason in the session summary.

## 8. Conventions

- IDs: UUID primary keys; human codes for display (`FR-01`, `US-001`, `TASK-001`).
- API errors: `{ error: { code, message, details? } }` with correct HTTP status.
- Generation endpoints accept an `Idempotency-Key` header and return `{ agentRunId }`.
- Prompts live in `src/ai/prompts/<stage>.v<N>.md`; bump N on meaningful changes and re-run `pnpm eval`.
- Every new service function gets a unit test; every new route gets an integration test.
- Commits: `PF-<id>: <imperative summary>` (e.g. `PF-024: add discovery stage schema and prompt`).
- Keep files under ~300 lines; split by responsibility when they grow.

## 9. Definition of done (every task)

- [ ] The task's "Done when" criteria in `docs/BACKLOG.md` are met
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- [ ] New logic has tests; AI-stage changes have been run through `pnpm eval:quick`
- [ ] Docs updated if behaviour, schema or API changed
- [ ] `docs/BACKLOG.md` and `docs/STATUS.md` updated
