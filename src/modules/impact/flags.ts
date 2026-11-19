/**
 * "Needs review" (PF-053, ADR-006/018), derived on every read: an item an approved change affected
 * stays flagged until it gets a new version after the change, is rejected, or is marked reviewed.
 */
import type { Prd } from "@/src/modules/prd/schema";
import type { Story } from "@/src/modules/stories/schema";

import {
  changeCode,
  type ChangeKind,
  type ImpactReview,
  type RequirementChange,
  type Severity,
} from "./schema";

export type ReviewFlag = {
  changeId: string;
  /** CR-01 */
  change: string;
  requirementCode: string | null;
  kind: ChangeKind;
  /** "FR-02 changed" */
  title: string;
  severity: Severity | null;
  explanation: string | null;
};

export type ReviewState = ReviewFlag & {
  ref: string;
  /** pending → still to do; updated → a version started after the change; reviewed → marked. */
  state: "pending" | "reviewed" | "updated" | "rejected" | "gone";
  version: number | null;
  reviewedBy: string | null;
  note: string | null;
};

export type PendingReviews = {
  /** Story code → the changes it hasn't been reviewed against. */
  stories: Map<string, ReviewFlag[]>;
  prd: ReviewFlag[];
  /** Flagged items: stories plus the PRD (once). */
  count: number;
};

const VERB: Record<ChangeKind, string> = { modify: "changed", add: "added", withdraw: "withdrawn" };

export function changeTitle(c: Pick<RequirementChange, "kind" | "requirementCode">): string {
  return `${c.requirementCode ?? "A new requirement"} ${VERB[c.kind]}`;
}

export const flagLabel = (f: Pick<ReviewFlag, "change" | "title">) => `${f.change}: ${f.title}`;

/** Where each item an approved change affected stands. Empty for proposed or discarded changes. */
export function reviewStates(
  c: RequirementChange,
  reviews: ImpactReview[],
  current: Story[],
  approvedPrd: Prd | null,
): ReviewState[] {
  if (c.status !== "APPROVED" || !c.decidedAt) return [];
  const decided = c.decidedAt;
  const marked = new Map(reviews.filter((r) => r.changeId === c.id).map((r) => [r.ref, r]));
  const base = (ref: string): Omit<ReviewState, "state" | "version"> => {
    const item = c.impact?.items.find((i) => i.ref === ref);
    const review = marked.get(ref);
    return {
      ref,
      changeId: c.id,
      change: changeCode(c.number),
      requirementCode: c.requirementCode,
      kind: c.kind,
      title: changeTitle(c),
      severity: item?.severity ?? null,
      explanation: item?.explanation ?? null,
      reviewedBy: review?.reviewedBy ?? null,
      note: review?.note || null,
    };
  };
  const out: ReviewState[] = [];
  if (c.affected.prd) {
    const at = approvedPrd ? (approvedPrd.approvedAt ?? approvedPrd.createdAt) : null;
    out.push({
      ...base("PRD"),
      version: approvedPrd?.version ?? null,
      state: marked.has("PRD") ? "reviewed" : !at ? "gone" : at > decided ? "updated" : "pending",
    });
  }
  const byCode = new Map(current.map((s) => [s.code, s]));
  for (const code of c.affected.stories) {
    const story = byCode.get(code);
    out.push({
      ...base(code),
      version: story?.version ?? null,
      state: marked.has(code)
        ? "reviewed"
        : !story
          ? "gone"
          : story.status === "REJECTED"
            ? "rejected"
            : story.createdAt > decided
              ? "updated"
              : "pending",
    });
  }
  return out;
}

export function pendingReviews(
  changes: RequirementChange[],
  reviews: ImpactReview[],
  current: Story[],
  approvedPrd: Prd | null,
): PendingReviews {
  const stories = new Map<string, ReviewFlag[]>();
  const prd: ReviewFlag[] = [];
  for (const c of changes) {
    for (const s of reviewStates(c, reviews, current, approvedPrd)) {
      if (s.state !== "pending") continue;
      const flag: ReviewFlag = {
        changeId: s.changeId,
        change: s.change,
        requirementCode: s.requirementCode,
        kind: s.kind,
        title: s.title,
        severity: s.severity,
        explanation: s.explanation,
      };
      if (s.ref === "PRD") prd.push(flag);
      else stories.set(s.ref, [...(stories.get(s.ref) ?? []), flag]);
    }
  }
  return { stories, prd, count: stories.size + (prd.length ? 1 : 0) };
}

export const EMPTY_REVIEWS: PendingReviews = { stories: new Map(), prd: [], count: 0 };
