import { flagLabel } from "@/src/modules/impact/flags";
import type { BacklogContext } from "@/src/modules/stories/state";

import type { Gap } from "./schema";

/** Items an approved requirement change flagged and nobody has reviewed yet (PF-053). */
export function reviewGaps(
  b: BacklogContext,
  links: { prd: string; story: (code: string) => string },
): Gap[] {
  const gaps: Gap[] = b.reviews.prd.map((f) => ({
    kind: "needs_review" as const,
    severity: "blocker" as const,
    message: `The approved PRD needs review after ${flagLabel(f)}`,
    codes: f.requirementCode ? [f.requirementCode] : [],
    action: { label: "Open the PRD", href: links.prd },
  }));
  for (const [code, flags] of [...b.reviews.stories].sort(([a], [c]) => a.localeCompare(c))) {
    gaps.push({
      kind: "needs_review",
      severity: "blocker",
      message: `${code} needs review after ${flags.map(flagLabel).join("; ")}`,
      codes: [code, ...flags.flatMap((f) => (f.requirementCode ? [f.requirementCode] : []))],
      action: { label: `Review ${code}`, href: links.story(code) },
    });
  }
  return gaps;
}
