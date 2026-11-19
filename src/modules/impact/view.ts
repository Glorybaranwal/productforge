/** What the Changes page shows (PF-053): each change with its impact and review checklist. */
import type { Requirement } from "@/src/modules/requirements/schema";
import type { BacklogContext } from "@/src/modules/stories/state";

import { changeTitle, reviewStates, type ReviewState } from "./flags";
import type { ChangeRows } from "./repository";
import { changeCode, type RequirementChange } from "./schema";

export type ReviewItem = ReviewState & { label: string; href: string };

export type ChangeView = RequirementChange & {
  code: string;
  title: string;
  /** After approval: every affected item and where it stands. */
  review: ReviewItem[];
  pending: number;
  /** Proposed only: the analysis is missing or the backlog has moved on since it ran. */
  needsAnalysis: boolean;
};

export type RequirementOption = Pick<
  Requirement,
  "code" | "text" | "type" | "evidence" | "version" | "status"
> & {
  /** CR-01 when the current version came from a change. */
  changedBy: string | null;
  /** An open proposal for this requirement. */
  proposed: string | null;
};

export type ChangesOverview = {
  gate1Passed: boolean;
  requirements: RequirementOption[];
  changes: ChangeView[];
  /** Items still flagged "Needs review" across all approved changes. */
  pending: number;
};

export function buildChangeViews(
  rows: ChangeRows,
  b: Pick<BacklogContext, "current" | "prd">,
  base: string,
  liveAffected: (c: RequirementChange) => string,
): ChangeView[] {
  const titles = new Map(b.current.map((s) => [s.code, s.title]));
  return rows.changes
    .map((c) => {
      const review = reviewStates(c, rows.reviews, b.current, b.prd).map((s) => ({
        ...s,
        label:
          s.ref === "PRD"
            ? `PRD${s.version ? ` v${s.version}` : ""}`
            : `${s.ref} ${titles.get(s.ref) ?? ""}`.trim(),
        href: s.ref === "PRD" ? `${base}/prd` : `${base}/backlog?story=${s.ref}`,
      }));
      const fingerprint = JSON.stringify(c.affected);
      return {
        ...c,
        code: changeCode(c.number),
        title: changeTitle(c),
        review,
        pending: review.filter((r) => r.state === "pending").length,
        needsAnalysis: c.status === "DRAFT" && (!c.impact || liveAffected(c) !== fingerprint),
      };
    })
    .reverse();
}

export function requirementOptions(
  current: Requirement[],
  changes: RequirementChange[],
): RequirementOption[] {
  return current.map((r) => {
    const by = changes.find(
      (c) => c.status === "APPROVED" && c.requirementCode === r.code && c.toVersion === r.version,
    );
    const open = changes.find((c) => c.status === "DRAFT" && c.requirementCode === r.code);
    return {
      code: r.code,
      text: r.text,
      type: r.type,
      evidence: r.evidence,
      version: r.version,
      status: r.status,
      changedBy: by ? changeCode(by.number) : null,
      proposed: open ? changeCode(open.number) : null,
    };
  });
}
