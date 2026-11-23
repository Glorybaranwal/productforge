import type { AgentRun, IdempotencyRecord } from "@/src/modules/agent-runs/schema";
import type { NewApiKey } from "@/src/modules/api-keys/schema";
import type { AuditLog } from "@/src/modules/audit/schema";
import type { ImpactReview, RequirementChange } from "@/src/modules/impact/schema";
import type { Prd } from "@/src/modules/prd/schema";
import type { Project } from "@/src/modules/projects/schema";
import type { ClarifyingQuestion, Discovery, Requirement } from "@/src/modules/requirements/schema";
import type { SourceDocument } from "@/src/modules/sources/schema";
import type { Sprint, SprintItem, SprintSettings } from "@/src/modules/sprints/schema";
import type { AcceptanceCriterion, Epic, Story, TechnicalTask } from "@/src/modules/stories/schema";
import type { Workspace, WorkspaceMember } from "@/src/modules/workspaces/schema";

/**
 * Demo-mode database (ADR-011): one JSON document with a collection per table.
 * Each module adds its collection here; older files are upgraded by `normalizeState`.
 */
export type DbState = {
  schemaVersion: 1;
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  projects: Project[];
  auditLogs: AuditLog[];
  // Module 0: API keys (PF-083)
  apiKeys: NewApiKey[];
  // Module 2
  sources: SourceDocument[];
  agentRuns: AgentRun[];
  idempotencyKeys: IdempotencyRecord[];
  requirements: Requirement[];
  questions: ClarifyingQuestion[];
  discoveries: Discovery[];
  // Module 3
  prds: Prd[];
  // Module 4
  epics: Epic[];
  stories: Story[];
  criteria: AcceptanceCriterion[];
  tasks: TechnicalTask[];
  // Module 7
  sprintSettings: SprintSettings[];
  sprints: Sprint[];
  sprintItems: SprintItem[];
  // Module 8
  changes: RequirementChange[];
  impactReviews: ImpactReview[];
};

export const COLLECTIONS = [
  "workspaces",
  "workspaceMembers",
  "projects",
  "auditLogs",
  "apiKeys",
  "sources",
  "agentRuns",
  "idempotencyKeys",
  "requirements",
  "questions",
  "discoveries",
  "prds",
  "epics",
  "stories",
  "criteria",
  "tasks",
  "sprintSettings",
  "sprints",
  "sprintItems",
  "changes",
  "impactReviews",
] as const;

export function emptyState(): DbState {
  return {
    schemaVersion: 1,
    workspaces: [],
    workspaceMembers: [],
    projects: [],
    auditLogs: [],
    apiKeys: [],
    sources: [],
    agentRuns: [],
    idempotencyKeys: [],
    requirements: [],
    questions: [],
    discoveries: [],
    prds: [],
    epics: [],
    stories: [],
    criteria: [],
    tasks: [],
    sprintSettings: [],
    sprints: [],
    sprintItems: [],
    changes: [],
    impactReviews: [],
  };
}

/** Accepts whatever was stored and returns a complete state (missing collections become empty). */
export function normalizeState(raw: unknown): DbState {
  const state = emptyState();
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of COLLECTIONS) {
      if (Array.isArray(record[key])) (state as Record<string, unknown>)[key] = record[key];
    }
  }
  return state;
}
