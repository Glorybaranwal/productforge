import { approveChange } from "@/src/modules/impact/decide";
import { proposeChange } from "@/src/modules/impact/service";
import { currentContext } from "@/src/modules/workspaces/service";

import { projectThroughGate1 } from "./discovery";

/** Passes Gate 1, then versions FR-07 twice through approved change requests (CR-01, CR-02). */
export async function projectWithTwoChanges() {
  const { projectId } = await projectThroughGate1();
  const ctx = await currentContext();
  const change = (text: string, reason: string) => ({
    kind: "modify",
    requirementCode: "FR-07",
    text,
    evidence: "EXPLICIT",
    reason,
  });
  for (const input of [
    change("Reports can be downloaded as PDF and Excel files", "Finance confirmed the formats"),
    change("Reports can be downloaded as PDF files only", "Excel was dropped from scope"),
  ]) {
    const { changeId } = await proposeChange(ctx, projectId, input, null);
    await approveChange(ctx, changeId);
  }
  return { projectId, ctx };
}
