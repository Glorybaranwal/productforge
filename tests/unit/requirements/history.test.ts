import { beforeEach, describe, expect, it } from "vitest";

import { setLLMClient } from "@/src/ai/llm-client";
import { getRequirementHistory } from "@/src/modules/requirements/history";
import { currentContext } from "@/src/modules/workspaces/service";
import { makeContext, resetDb } from "@/tests/helpers/context";
import { projectThroughGate1 } from "@/tests/helpers/discovery";
import { projectWithTwoChanges } from "@/tests/helpers/requirement-history";

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("getRequirementHistory (PF-056)", () => {
  it("lists only requirements with more than one version, oldest first, each linked to its change request", async () => {
    const { projectId, ctx } = await projectWithTwoChanges();
    const history = await getRequirementHistory(ctx, projectId);
    expect(history.map((h) => h.code)).toEqual(["FR-07"]);
    const [v1, v2, v3] = history[0]!.versions;
    expect([v1!.version, v2!.version, v3!.version]).toEqual([1, 2, 3]);
    expect(v1!.change).toBeNull();
    expect(v2!.change).toEqual({
      code: "CR-01",
      reason: "Finance confirmed the formats",
      status: "APPROVED",
    });
    expect(v3!.change?.code).toBe("CR-02");
    expect(v3!.text).toBe("Reports can be downloaded as PDF files only");
    expect(v3!.evidence).toBe("EXPLICIT");
  });

  it("is empty when no requirement has been changed", async () => {
    const { projectId } = await projectThroughGate1();
    const ctx = await currentContext();
    expect(await getRequirementHistory(ctx, projectId)).toEqual([]);
  });

  it("answers NOT_FOUND for a project of another workspace", async () => {
    const { projectId } = await projectWithTwoChanges();
    const outsider = await makeContext("owner", "Outsider");
    const err = await getRequirementHistory(outsider, projectId).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets every member read it", async () => {
    const { projectId, ctx } = await projectWithTwoChanges();
    const history = await getRequirementHistory({ ...ctx, role: "developer" }, projectId);
    expect(history).toHaveLength(1);
  });
});
