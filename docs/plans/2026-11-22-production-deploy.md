# Plan — PF-064 production deploy + demo seed (2026-11-22)

Spec: `docs/BACKLOG.md` PF-064, ADR-011 (demo mode), ADR-021/022 (auth, data drivers), ADR-024 (Mumbai), ADR-025 (CI and
deploys), ADR-031 (Postgres-only mode). Branch `launch` (from `m0-platform`).

## Global constraints
- CLAUDE.md §7–§9. Secrets only in env vars; `.env.example` lists every variable. Never print secret values.
- Production runs `DATA_DRIVER=postgres` with Supabase sign-in; the demo store must never be used there (ADR-031).
- No new dependencies (tsx is already installed).

## Task 1 — `pnpm db:seed`: seed the demo project for a user
A service `seedDemoProject(ctx)` creates "Transaction monitoring dashboard (demo)" for the caller's workspace and runs
it through the real pipeline with the demo engine (no tokens): source from fixture 001 → discovery → resolve every
question → Gate 1 → PRD → approve → backlog → approve ready stories → plan sprints. Idempotent (skips if the project
exists). `scripts/db-seed.ts` (run with tsx) finds the user by `--email` and calls it as that user under RLS.

## Task 2 — production config and runbook
Remove `git.deploymentEnabled.main = false` from `vercel.json`; `docs/DEPLOY.md` runbook listing every production env
var (names only), the Supabase redirect URL, branch protection, the order of steps, and a smoke test.
