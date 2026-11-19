import type { Candidates } from "@/src/modules/impact/candidates";
import type { ChangeKind, RequirementSnapshot } from "@/src/modules/impact/schema";

export { ImpactOutput } from "@/src/modules/impact/schema";

/** What the impact stage receives: the change and the items the rules found — nothing else. */
export type ImpactInput = {
  project: { name: string; domain: string };
  change: {
    kind: ChangeKind;
    /** FR-02, or null for a requirement that doesn't have a code yet. */
    code: string | null;
    before: RequirementSnapshot | null;
    after: RequirementSnapshot | null;
    reason: string;
  };
  candidates: Candidates;
};
