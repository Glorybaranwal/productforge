# Architecture — ProductForge AI

Diagrams: https://claude.ai/artifact/7QjwDZennjKuBajC2y8RhS (sections 2 and 3)

## Overview

Modular monolith (ADR-001). One Next.js app, one Postgres database, and an AI orchestration layer that runs a fixed
pipeline of stages (ADR-002). Every AI output is validated before it reaches the database.

```
Browser ──► Web UI ──► API route handlers ──► Domain services ──► Repositories ──► Postgres (Supabase, RLS)
                              │                                                   Storage (uploads)
                              ▼
                     AI orchestrator ──► LLMClient ──► OpenAI (structured outputs)
                              │
          Discovery → PRD → Stories → QA → Tasks   (+ Impact on change requests, ADR-018;
                                                   sprint planning is deterministic, ADR-017)
                              │
                     Validator (Zod + business rules) ──► drafts saved + agent_runs logged
```

## Layers

| Layer | Location | Rule |
| --- | --- | --- |
| Routes / UI | `app/`, `components/` | No business logic; call services |
| API | `app/api/**/route.ts` | Auth, role check, Zod input validation, call service |
| Services | `src/modules/*/service.ts` | Business logic, transactions |
| Repositories | `src/modules/*/repository.ts` | Only place that touches the DB (Drizzle). Runs inside `withUser` so RLS applies; `adminDb` only for migrations, seed and system jobs (ADR-005) |
| AI | `src/ai/**` | Only place that calls the model |

## AI stage contract

Every stage in `src/ai/stages/<name>.stage.ts` exports:

```ts
export const discoveryStage: Stage<DiscoveryInput, DiscoveryOutput> = {
  name: "discovery",
  promptFile: "discovery.v1.md",
  inputSchema: DiscoveryInput,
  outputSchema: DiscoveryOutput,
  loadContext: async (ctx) => { /* load only what's needed, by ID */ },
  businessRules: [ /* (output, ctx) => RuleViolation[] */ ],
  persist: async (output, ctx, tx) => { /* save as DRAFT with trace links */ },
};
```

Runner (`src/ai/orchestrator/run-stage.ts`):
1. Create `agent_runs` row (`running`). Refused with 409 while the same stage is already running for
   the project; a run left `running` for 10 minutes counts as abandoned (ADR-027).
2. `loadContext` → build prompt (system prompt + delimited untrusted input).
3. `llm.generateStructured({ schema: outputSchema })`.
4. Zod parse → business rules. On failure retry once with errors appended; then fail the run.
5. `persist` in one transaction. Update run (`succeeded`, tokens, cost, latency).
6. Emit SSE events at each step.

| Stage | Input | Output |
| --- | --- | --- |
| discovery | raw text + docs + project context (+ answers) | requirements w/ evidence, actors, goals, constraints, questions, conflicts, ambiguity flags |
| prd | approved requirements | PRD sections; FR/NFR reference requirement IDs |
| story | approved PRD + requirements | epics, stories (requirementIds ≥ 1), priority, dependencies |
| qa | stories | Given/When/Then (positive/negative/edge), untestable flags |
| task | approved stories | technical tasks + estimates, suggested points |
| impact | a proposed requirement change + the items rules found linked to it | summary + per-item severity and explanation (only listed items) |

## Data model

Common columns on generated entities: `id uuid`, `workspace_id`, `project_id`, `status`, `evidence`,
`origin (ai|human|ai_edited)`, `agent_run_id`, `created_by`, `created_at`, `updated_at`.

| Table | Key columns |
| --- | --- |
| workspaces | name, owner_id |
| workspace_members | workspace_id, user_id, role (owner/admin/pm/developer/qa) |
| projects | workspace_id, name, domain, audience, team_size, sprint_length_days |
| source_documents | project_id, storage_path, mime, size, extracted_text |
| requirements | code (FR-01), version, text, type (functional/non_functional), source_document_id |
| clarifying_questions | project_id, question, answer, state (open/answered/skipped/assumption) |
| prds | project_id, version, content jsonb, status (DRAFT/APPROVED), origin, based_on_version, agent_run_id, created_by, approved_by (name), approved_at. One open draft per project; approved versions never change; never deleted (ADR-028) |
| epics | code (EP-01), title, description |
| user_stories | epic_id, code (US-001), version, title, persona, description, priority, story_points |
| story_requirements | story_id, requirement_id, requirement_version |
| story_dependencies | story_id, depends_on_story_id |
| acceptance_criteria | story_id, kind (positive/negative/edge), given, when, then, position |
| technical_tasks | story_id, code (TASK-001), title, description, estimate_hours, position |
| sprint_settings | project_id, velocity, start_date (one row per project) |
| sprints | project_id, number, goal, auto_goal, capacity_points (dates derive from settings + sprint length) |
| sprint_items | project_id, story_code, sprint_number, position, pinned, reason (ADR-017) |
| requirement_changes | project_id, number (CR-01), kind (modify/add/withdraw), requirement_code, from_version, to_version, before, after, reason, status, affected jsonb, impact jsonb, agent_run_id, decided_by, decided_at (ADR-018) |
| impact_reviews | change_id, ref (PRD or story code), note, reviewed_by, reviewed_at |
| agent_runs | project_id, stage, provider, model, prompt_version, status, attempts, tokens_in, tokens_out, cost_usd, latency_ms, input_hash, error, events jsonb, created_by, finished_at. One `running` row per project + stage; never deleted (ADR-027) |
| idempotency_records | workspace_id, operation, key, result_id, created_by (primary key: workspace + operation + key) |
| audit_logs | actor_id, entity_type, entity_id, action, diff jsonb |

Status values: `DRAFT`, `REVIEW`, `APPROVED`, `REJECTED`, `NEEDS_REVIEW`.
Versioning: ADR-006. RLS: every table filtered by membership in `workspace_id`.

## API

All generate endpoints: `Idempotency-Key` header, return `{ agentRunId }`, progress via SSE.
Errors: `{ error: { code, message, details? } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST / GET | /api/projects | Create / list projects |
| POST | /api/projects/:id/documents | Upload a document (PDF/DOCX, PF-023) |
| GET / POST / DELETE | /api/projects/:id/sources[/:sourceId] | Text sources: pasted or .txt/.md |
| POST | /api/projects/:id/requirements | Add a requirement by hand |
| PATCH | /api/requirements/:id | Edit, reject or restore a draft requirement |
| GET / POST | /api/projects/:id/discovery | Discovery state / run discovery (Idempotency-Key) |
| PATCH | /api/questions/:id | Answer, skip or assume a question (re-run via POST discovery) |
| POST | /api/projects/:id/discovery/confirm | Gate 1 |
| GET | /api/projects/:id/prd | PRD state: versions, approved requirements, Gate 2 blockers, latest run |
| POST | /api/projects/:id/prd/generate | Generate or regenerate the draft (Idempotency-Key) |
| GET / PATCH | /api/prds/:id | Read a version / edit one section of a draft (`{ section, value }`) |
| POST | /api/prds/:id/approve | Gate 2 (latest version, no blockers) |
| POST | /api/prds/:id/new-version | Copy an approved version into a new draft (n+1) |
| GET | /api/prds/:id/markdown | PRD as a Markdown file |
| GET | /api/projects/:id/backlog | Epics, current stories with criteria and tasks, coverage, Gate 3 |
| POST | /api/projects/:id/backlog/generate | Fill gaps: stories → criteria → tasks (Idempotency-Key) |
| POST | /api/projects/:id/backlog/approve | Approve every draft story without blockers |
| GET | /api/projects/:id/backlog/markdown | Approved stories as Markdown |
| POST | /api/projects/:id/stories | Add a story by hand |
| GET / PATCH | /api/stories/:id | Read a version / autosave one section (`story`, `criteria`, `tasks`) |
| POST | /api/stories/:id/approve · /reject · /restore · /regenerate · /new-version | Gate 3 actions |
| GET | /api/projects/:id/traceability | Requirement → PRD → stories → criteria → tasks matrix, score, gaps |
| GET | /api/projects/:id/traceability/csv | The matrix as CSV (audit-logged export) |
| GET | /api/projects/:id/exports | What would be exported (approved items only) and the export history |
| POST | /api/projects/:id/exports/jira | Jira CSV (Cloud / Data Center) or JSON; audit-logged |
| GET | /api/projects/:id/sprints | Sprint board: sprints, stories, not planned (with reasons), warnings, forecast |
| PUT | /api/projects/:id/sprints/settings | Velocity and sprint 1 start date |
| POST | /api/projects/:id/sprints/plan | Automatic plan of approved stories (`keepPinned`, default true) |
| POST | /api/projects/:id/sprints/move | Place a story by hand (`sprintNumber`, or null to take it out); pinned |
| PATCH | /api/sprints/:id | Sprint goal and capacity |
| GET | /api/projects/:id/changes | Change requests with impact and review checklists; current requirement versions |
| POST | /api/projects/:id/changes | Propose a change (`kind`, …, `reason`) and run the impact analysis (Idempotency-Key) |
| POST | /api/changes/:id/analyze · /approve · /discard | Re-run the analysis · put in force (next requirement version) · drop |
| POST | /api/changes/:id/reviews | Mark a flagged item (`PRD` or a story code) reviewed, with an optional note |
| GET | /api/agent-runs/:id · /stream | Run status / SSE |

## Security

- RLS on every project-data table; integration test per policy.
- Roles: only owner/admin/pm can approve.
- AI keys server-only. Uploads: MIME + size checks, server-side extraction.
- Prompt-injection defence: untrusted text in delimited blocks; system prompt says it is data only.
- Rate limits + monthly token budget per workspace.

## Testing

| Layer | Tool | Location |
| --- | --- | --- |
| Unit | Vitest | `tests/unit` |
| Integration (API, RLS) | Vitest + local Supabase | `tests/integration` |
| E2E | Playwright (model mocked) | `tests/e2e` |
| AI evals | `pnpm eval` | `tests/ai-evals` |
