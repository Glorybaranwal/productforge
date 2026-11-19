# PRD — ProductForge AI

Full version with diagrams: https://claude.ai/artifact/7QjwDZennjKuBajC2y8RhS

## Summary

ProductForge AI turns a raw business idea, meeting notes or documents into a human-approved, sprint-ready backlog:
PRD, epics, user stories, acceptance criteria and technical tasks — each linked to the requirement it came from.

**Positioning:** From idea to sprint-ready backlog in minutes, with every AI output reviewed by a human and
traceable to its source.

## Problem

PMs spend hours turning unstructured input into specs. The work is repetitive, inconsistent, and requirements get
lost between the PRD and the tickets.

## Users

| User | Need |
| --- | --- |
| **Product Manager (primary)** | Idea → structured PRD and backlog |
| Startup founder | Idea → execution roadmap |
| Business analyst | Find gaps and conflicts in requirements |
| Engineering lead | Clear, implementable tasks |
| QA engineer | Testable acceptance criteria |

## Product principles

1. Human-in-the-loop: nothing is approved without a person.
2. Evidence over confidence: every item is `EXPLICIT`, `INFERRED`, `ASSUMPTION` or `OPEN_QUESTION`.
3. Traceability by default: story → requirement links are mandatory.
4. Never overwrite: approved artifacts are versioned.
5. Uploaded content is data, never instructions.

## User flow

1. Create project → 2. Submit idea/docs → 3. AI discovery + questions → **Gate 1: confirm requirements** →
4. Generate PRD → **Gate 2: approve PRD** → 5. Generate stories, criteria, tasks → **Gate 3: approve backlog** →
6. Export (Jira CSV / JSON).
A requirement change after approval marks linked items "Needs review".

## Functional requirements (MVP)

| ID | Requirement |
| --- | --- |
| FR-01 | Create workspaces and projects (name, domain, audience, team size, sprint length) |
| FR-02 | Submit text input and upload PDF/DOCX/TXT |
| FR-03 | Extract requirements with evidence labels, actors, goals, constraints |
| FR-04 | Generate clarifying questions; flag conflicts and ambiguous terms |
| FR-05 | Answer/skip/mark-as-assumption questions and re-run discovery |
| FR-06 | Generate an editable, versioned PRD; approve it |
| FR-07 | Generate epics and stories linked to requirements, with priority and dependencies |
| FR-08 | Generate Given/When/Then criteria (positive, negative, edge) per story |
| FR-09 | Generate technical tasks with estimates per story |
| FR-10 | Approve / reject / edit / regenerate any artifact |
| FR-11 | Traceability view with requirement coverage score |
| FR-12 | Export approved items as Jira-compatible CSV and JSON |
| FR-13 | (Stretch) Sprint allocation by capacity and dependencies |
| FR-14 | (Stretch) Change-impact flags when an approved requirement changes |

## Non-functional requirements

- First PRD section streams within 10 s; full PRD < 2 min.
- Multi-tenant isolation via RLS; roles Owner / Admin / PM / Developer / QA.
- Server-side AI keys; rate limits and per-workspace cost caps.
- Every AI call logged with tokens, cost, latency, status.
- Audit log for approvals, edits, rejections, exports.
- WCAG AA contrast, keyboard-navigable editors.

## Out of scope (MVP)

Jira API sync, real-time collaboration, analytics, domain templates, duplicate detection.

## Success metrics (on the eval set; targets, not claims)

| Metric | Target |
| --- | --- |
| Time to first PRD draft | < 2 min |
| Schema-valid AI output | ≥ 95 % |
| Requirement-to-story coverage | ≥ 90 % |
| AI artifact approval rate | ≥ 80 % |
| Traceability of approved stories | 100 % |
| Workflow completion | ≥ 95 % |
