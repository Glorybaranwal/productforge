import { describe, expect, it } from "vitest";

import { pendingReviews, reviewStates } from "@/src/modules/impact/flags";
import type { ImpactReview, RequirementChange } from "@/src/modules/impact/schema";
import type { Prd } from "@/src/modules/prd/schema";
import { currentRequirements } from "@/src/modules/requirements/repository";
import type { Requirement } from "@/src/modules/requirements/schema";
import type { Story } from "@/src/modules/stories/schema";

const WS = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const DECIDED = "2026-11-19T10:00:00.000Z";
const BEFORE = "2026-11-19T09:00:00.000Z";
const AFTER = "2026-11-19T11:00:00.000Z";

const change = (over: Partial<RequirementChange> = {}): RequirementChange => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  workspaceId: WS,
  projectId: PROJECT,
  number: 1,
  kind: "modify",
  requirementCode: "FR-02",
  fromVersion: 1,
  toVersion: 2,
  before: { text: "Old", type: "functional", evidence: "EXPLICIT" },
  after: { text: "New", type: "functional", evidence: "EXPLICIT" },
  reason: "Because",
  status: "APPROVED",
  affected: { prd: true, stories: ["US-001", "US-002", "US-003", "US-004", "US-005"] },
  impact: {
    summary: "FR-02 changes.",
    items: [
      { ref: "US-001", kind: "story", severity: "high", explanation: "Still says the old thing." },
    ],
  },
  agentRunId: null,
  createdBy: "Demo PM",
  createdAt: BEFORE,
  decidedBy: "Demo PM",
  decidedAt: DECIDED,
  ...over,
});
const story = (code: string, createdAt: string, status: Story["status"] = "APPROVED") =>
  ({ code, createdAt, status, version: createdAt > DECIDED ? 2 : 1 }) as Story;
const prd = (approvedAt: string | null) => ({ version: 1, approvedAt, createdAt: BEFORE }) as Prd;
const review = (ref: string): ImpactReview => ({
  workspaceId: WS,
  projectId: PROJECT,
  changeId: change().id,
  ref: ref as ImpactReview["ref"],
  note: "Fine as is",
  reviewedBy: "Demo PM",
  reviewedAt: AFTER,
});

const stories = [
  story("US-001", BEFORE),
  story("US-002", AFTER, "DRAFT"), // a new version started after the change
  story("US-003", BEFORE, "REJECTED"),
  story("US-004", BEFORE, "DRAFT"),
];

describe("needs review (PF-053)", () => {
  it("tracks each affected item until it's updated, rejected or marked reviewed", () => {
    const states = reviewStates(change(), [review("US-004")], stories, prd(BEFORE));
    expect(states.map((s) => [s.ref, s.state])).toEqual([
      ["PRD", "pending"],
      ["US-001", "pending"],
      ["US-002", "updated"],
      ["US-003", "rejected"],
      ["US-004", "reviewed"],
      ["US-005", "gone"],
    ]);
    expect(states[1]).toMatchObject({ change: "CR-01", title: "FR-02 changed", severity: "high" });
    expect(states[4]).toMatchObject({ reviewedBy: "Demo PM", note: "Fine as is" });
  });

  it("clears the PRD once a version is approved after the change", () => {
    expect(reviewStates(change(), [], stories, prd(AFTER))[0]!.state).toBe("updated");
    expect(reviewStates(change(), [review("PRD")], stories, prd(BEFORE))[0]!.state).toBe(
      "reviewed",
    );
  });

  it("flags nothing for proposed or discarded changes", () => {
    expect(
      reviewStates(change({ status: "DRAFT", decidedAt: null }), [], stories, prd(BEFORE)),
    ).toEqual([]);
    expect(reviewStates(change({ status: "REJECTED" }), [], stories, prd(BEFORE))).toEqual([]);
  });

  it("groups pending flags by story, with the PRD counted once", () => {
    const second = change({
      id: "00000000-0000-4000-8000-0000000000c2",
      number: 2,
      kind: "withdraw",
      requirementCode: "FR-05",
      impact: null,
    });
    const pending = pendingReviews([change(), second], [], stories, prd(BEFORE));
    expect([...pending.stories.keys()]).toEqual(["US-001", "US-004"]);
    expect(pending.stories.get("US-001")!.map((f) => `${f.change} ${f.title}`)).toEqual([
      "CR-01 FR-02 changed",
      "CR-02 FR-05 withdrawn",
    ]);
    expect(pending.prd.length).toBe(2);
    expect(pending.count).toBe(3);
  });
});

describe("requirement versions (ADR-006)", () => {
  it("the current version is the highest per code, in first-seen order", () => {
    const r = (code: string, version: number, status: Requirement["status"] = "APPROVED") =>
      ({ code, version, status }) as Requirement;
    const current = currentRequirements([
      r("FR-01", 1),
      r("FR-02", 1),
      r("NFR-01", 1),
      r("FR-02", 2),
      r("FR-01", 2, "REJECTED"),
    ]);
    expect(current.map((x) => `${x.code} v${x.version} ${x.status}`)).toEqual([
      "FR-01 v2 REJECTED",
      "FR-02 v2 APPROVED",
      "NFR-01 v1 APPROVED",
    ]);
  });
});
