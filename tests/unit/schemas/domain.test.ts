/**
 * PF-003: every domain schema accepts a valid sample and rejects two invalid ones, so the rules the
 * AI output and the API rely on are pinned down (CLAUDE.md §7: Zod is the source of truth).
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { Prd } from "@/src/modules/prd/schema";
import { ClarifyingQuestion, Requirement } from "@/src/modules/requirements/schema";
import { Sprint } from "@/src/modules/sprints/schema";
import { AcceptanceCriterion, Epic, Story, TechnicalTask } from "@/src/modules/stories/schema";

const ID = "00000000-0000-4000-8000-000000000001";
const AT = "2026-11-20T10:00:00.000Z";
const owned = { id: ID, workspaceId: ID, projectId: ID };
const generated = {
  ...owned,
  status: "DRAFT",
  evidence: "EXPLICIT",
  origin: "ai",
  agentRunId: ID,
  createdAt: AT,
  updatedAt: AT,
};

const prdContent = {
  summary: "A dashboard for retail banking transactions",
  problem: "Customers can't see failed payments",
  goals: [{ goal: "Fewer support calls", metric: "-20% calls about payments" }],
  personas: [{ name: "Customer", needs: "See and filter transactions" }],
  inScope: ["Transaction list"],
  outOfScope: [],
  functionalRequirements: [{ text: "View transactions", requirementCodes: ["FR-01"] }],
  nonFunctionalRequirements: [],
  dependencies: [],
  assumptions: [],
  risks: [],
  openQuestions: [],
};

type Case = {
  schema: z.ZodType;
  valid: Record<string, unknown>;
  /** Each change makes the sample invalid, and says why. */
  invalid: [string, Record<string, unknown>][];
};

const cases: Record<string, Case> = {
  Requirement: {
    schema: Requirement,
    valid: {
      ...generated,
      code: "FR-01",
      version: 1,
      text: "Customers can view transactions",
      type: "functional",
      sourceQuote: "Customers can view transactions",
      rationale: null,
      sourceId: null,
      approvedBy: null,
      approvedAt: null,
    },
    invalid: [
      ["a code that isn't FR-nn / NFR-nn", { code: "REQ-1" }],
      ["an unknown evidence label", { evidence: "GUESS" }],
    ],
  },
  ClarifyingQuestion: {
    schema: ClarifyingQuestion,
    valid: {
      ...owned,
      question: "Which channel should notifications use?",
      reason: "No channel is specified",
      state: "open",
      answer: null,
      agentRunId: null,
      createdAt: AT,
      resolvedAt: null,
    },
    invalid: [
      ["an empty question", { question: "" }],
      ["an unknown state", { state: "ignored" }],
    ],
  },
  Prd: {
    schema: Prd,
    valid: {
      ...owned,
      version: 1,
      status: "DRAFT",
      origin: "ai",
      agentRunId: ID,
      basedOnVersion: null,
      createdBy: ID,
      createdAt: AT,
      updatedAt: AT,
      approvedBy: null,
      approvedAt: null,
      content: prdContent,
    },
    invalid: [
      [
        "a requirement line without a requirement link",
        {
          content: { ...prdContent, functionalRequirements: [{ text: "x", requirementCodes: [] }] },
        },
      ],
      ["a status other than DRAFT or APPROVED", { status: "REVIEW" }],
    ],
  },
  Epic: {
    schema: Epic,
    valid: { ...generated, code: "EP-01", title: "Transactions", description: "" },
    invalid: [
      ["a code that isn't EP-nn", { code: "E1" }],
      ["no title", { title: "" }],
    ],
  },
  Story: {
    schema: Story,
    valid: {
      ...generated,
      epicId: ID,
      code: "US-001",
      version: 1,
      basedOnVersion: null,
      title: "View transactions",
      asA: "customer",
      iWant: "to see my transactions",
      soThat: "I can spot failed payments",
      priority: "must",
      storyPoints: 5,
      requirementCodes: ["FR-01"],
      dependsOn: [],
      rationale: null,
      rejectionReason: null,
      prdVersion: 1,
      createdBy: ID,
      approvedBy: null,
      approvedAt: null,
    },
    invalid: [
      ["no linked requirement (traceability)", { requirementCodes: [] }],
      ["story points off the Fibonacci scale", { storyPoints: 4 }],
    ],
  },
  AcceptanceCriterion: {
    schema: AcceptanceCriterion,
    valid: {
      ...generated,
      storyId: ID,
      kind: "negative",
      given: "a failed payment",
      when: "the customer opens the list",
      then: "the payment is marked failed",
      position: 0,
    },
    invalid: [
      ["an unknown kind", { kind: "happy" }],
      ["no Then", { then: "" }],
    ],
  },
  TechnicalTask: {
    schema: TechnicalTask,
    valid: {
      ...generated,
      storyId: ID,
      code: "TASK-001",
      title: "Build the list endpoint",
      description: "",
      estimateHours: 6,
      position: 0,
      sprintId: null,
    },
    invalid: [
      ["an estimate over 40 hours (split it)", { estimateHours: 60 }],
      ["a code that isn't TASK-nnn", { code: "T-1" }],
    ],
  },
  Sprint: {
    schema: Sprint,
    valid: {
      ...owned,
      number: 1,
      goal: "Customers see their transactions",
      autoGoal: true,
      capacityPoints: 20,
      createdAt: AT,
      updatedAt: AT,
    },
    invalid: [
      ["sprint number 0", { number: 0 }],
      ["negative capacity", { capacityPoints: -5 }],
    ],
  },
};

describe("domain schemas (PF-003)", () => {
  for (const [name, { schema, valid, invalid }] of Object.entries(cases)) {
    it(`${name} accepts a valid sample`, () => {
      expect(schema.safeParse(valid).success).toBe(true);
    });
    for (const [why, change] of invalid) {
      it(`${name} rejects ${why}`, () => {
        expect(schema.safeParse({ ...valid, ...change }).success).toBe(false);
      });
    }
  }
});
