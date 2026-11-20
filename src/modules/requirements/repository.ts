import { dataBackend, type WorkspaceScope } from "@/src/db/scope";

import { pgQuestions, pgRequirements } from "./pg-repository";
import type { ClarifyingQuestion, Requirement } from "./schema";
import { storeQuestions, storeRequirements } from "./store-repository";

export { currentRequirements, nextCode } from "./codes";

export type NewRequirement = Omit<Requirement, "code">;

/** Requirements are versioned (ADR-006): an approved row is never changed; a change is a new version. */
export interface RequirementRepository {
  /** Current versions only — what every screen and stage works from. */
  listByProject(scope: WorkspaceScope, projectId: string): Promise<Requirement[]>;
  /** Every version, oldest first (change history, PF-053). */
  listVersions(scope: WorkspaceScope, projectId: string): Promise<Requirement[]>;
  /** Inserts a new version of an existing code, or a new code when `code` is null. */
  insertVersion(
    scope: WorkspaceScope,
    row: NewRequirement & { code: string | null },
  ): Promise<Requirement>;
  findById(scope: WorkspaceScope, id: string): Promise<Requirement | null>;
  /** Inserts with the next free code for its type. */
  insert(scope: WorkspaceScope, requirement: NewRequirement): Promise<Requirement>;
  update(
    scope: WorkspaceScope,
    id: string,
    patch: Partial<Requirement>,
  ): Promise<Requirement | null>;
  /** Gate 1: every DRAFT requirement of the project becomes APPROVED. Returns how many. */
  approveDrafts(scope: WorkspaceScope, projectId: string, by: string, at: string): Promise<number>;
}

export interface QuestionRepository {
  listByProject(scope: WorkspaceScope, projectId: string): Promise<ClarifyingQuestion[]>;
  findById(scope: WorkspaceScope, id: string): Promise<ClarifyingQuestion | null>;
  update(
    scope: WorkspaceScope,
    id: string,
    patch: Partial<ClarifyingQuestion>,
  ): Promise<ClarifyingQuestion | null>;
}

const postgres = () => dataBackend() === "postgres";

/** Demo store or Postgres, chosen per call by `DATA_DRIVER` (ADR-022, ADR-026). */
export const requirementRepository: RequirementRepository = {
  listByProject: (...a) => (postgres() ? pgRequirements : storeRequirements).listByProject(...a),
  listVersions: (...a) => (postgres() ? pgRequirements : storeRequirements).listVersions(...a),
  insertVersion: (...a) => (postgres() ? pgRequirements : storeRequirements).insertVersion(...a),
  findById: (...a) => (postgres() ? pgRequirements : storeRequirements).findById(...a),
  insert: (...a) => (postgres() ? pgRequirements : storeRequirements).insert(...a),
  update: (...a) => (postgres() ? pgRequirements : storeRequirements).update(...a),
  approveDrafts: (...a) => (postgres() ? pgRequirements : storeRequirements).approveDrafts(...a),
};

export const questionRepository: QuestionRepository = {
  listByProject: (...a) => (postgres() ? pgQuestions : storeQuestions).listByProject(...a),
  findById: (...a) => (postgres() ? pgQuestions : storeQuestions).findById(...a),
  update: (...a) => (postgres() ? pgQuestions : storeQuestions).update(...a),
};
