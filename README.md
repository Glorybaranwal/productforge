# ProductForge AI

From idea to sprint-ready backlog in minutes — with every AI output reviewed by a human and traceable to its source.

ProductForge AI turns business ideas, meeting notes and documents into a PRD, epics, user stories, acceptance
criteria and technical tasks, linked requirement → story → criterion → task.

> Status: early development. See `docs/STATUS.md`.

## Run it

**Easiest:** double-click `Start ProductForge.command` in this folder (Finder). It installs on first run and opens
http://localhost:3000/dashboard. Or from a terminal:

```bash
corepack enable && pnpm install
pnpm dev            # http://localhost:3000 — demo mode, no accounts or keys needed (ADR-011)
pnpm lint && pnpm typecheck && pnpm test
```

Demo data is saved in `.data/productforge.json`; delete it to start fresh.
Live preview (browser-only build): https://claude.ai/artifact/UAKA9Kf7A8vRiXNyGbhkWo

## Docs

- `docs/PRD.md` — product requirements
- `docs/ARCHITECTURE.md` — architecture, data model, API, AI pipeline
- `docs/DECISIONS.md` — architecture decision records
- `docs/BACKLOG.md` — ordered tasks with acceptance criteria
- `docs/STATUS.md` — current progress and session log

## Working with Claude Code

`CLAUDE.md` holds the working agreement. Two commands drive each session:

- `/next` — reads status + backlog, picks the next task, plans and builds it
- `/next PF-024` — work on a specific task
- `/wrap` — runs checks, updates backlog/status/decisions, suggests a commit

## Stack

Next.js · React · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres, Auth, Storage) · Zod · OpenAI Responses API ·
Vitest · Playwright · GitHub Actions · Vercel

## Checks and previews

Every pull request runs lint, typecheck, tests (including the row-level security and data-isolation tests), a
production build and a dependency audit (`.github/workflows/ci.yml`). Vercel builds a preview of each pull request in
demo mode, in Mumbai; `main` doesn't auto-deploy yet (ADR-025).
