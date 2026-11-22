# Plan — review the developed code, then continue the backlog (2026-11-22)

Spec: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/BACKLOG.md` (the task texts are binding).

## Global constraints
- CLAUDE.md §7 non-negotiable rules and §8 conventions; files under ~300 lines.
- Every new service function gets a unit test; every new route an integration test (CLAUDE.md §8).
- Commit format `PF-<id>: <imperative summary>`; commit on branch `m0-platform`; never push.
- Members may edit drafts; only owners, admins and PMs generate, approve, plan (ADR-014, ADR-028, ADR-035).
- No new dependency (no network for installs).

## Task 1 — Fix the review findings
Fix every Critical and Important finding from the whole-codebase review (`main..501ad90`) listed in the ledger.
Each fix ships with a test that fails without it. Minor findings go to `docs/BACKLOG.md` as tasks, not code.

## Task 2 — PF-035: split `components/prd/prd-workspace.tsx`
Move the toolbar, Gate 2 panel and traceability panel into their own files. Done when every PRD component file
is under 300 lines, `pnpm lint` shows no `max-lines` warning, and behaviour is unchanged. Remove the duplicate
PF-079 from `docs/BACKLOG.md` (it is PF-035).

## Task 3 — PF-056: requirement history view
On the discovery page, show each requirement's versions side by side (v1 → v2 wording, evidence, the change
request and reason), like the PRD's version compare. Done when every requirement with more than one version can be
compared, and each version links its CR.

## Task 4 — PF-029: eval Tier 2 judge
LLM judge for expected items Tier 1 missed (ADR-010): `tests/ai-evals/judge.v1.md`, temperature 0, JSON verdict.
Done when full `pnpm eval` reports which tier matched each item. The judge goes through `src/ai/llm-client.ts`;
the demo engine path must stay deterministic so `pnpm eval:quick` in CI needs no key.
