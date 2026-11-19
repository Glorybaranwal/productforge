export { PrdContent } from "@/src/modules/prd/schema";

/** What the PRD stage receives: only Gate 1-approved requirements and the clarification record. */
export type PrdInput = {
  project: {
    name: string;
    domain: string;
    audience: string;
    teamSize: number;
    sprintLengthDays: number;
  };
  discovery: { summary: string; actors: string[]; goals: string[]; constraints: string[] };
  /** Approved requirements: the only things the PRD may claim. */
  requirements: {
    code: string;
    text: string;
    type: "functional" | "non_functional";
    evidence: "EXPLICIT" | "INFERRED" | "ASSUMPTION" | "OPEN_QUESTION";
    rationale: string | null;
  }[];
  /** Requirements rejected at Gate 1: candidates for "out of scope". */
  rejected: string[];
  clarifications: {
    question: string;
    state: "answered" | "assumption" | "skipped";
    answer: string | null;
  }[];
  /** Conflicts still listed when requirements were confirmed. */
  conflicts: { description: string; question: string }[];
};
