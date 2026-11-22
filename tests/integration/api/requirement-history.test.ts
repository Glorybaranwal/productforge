import { beforeEach, describe, expect, it } from "vitest";

import * as historyRoute from "@/app/api/projects/[id]/requirements/history/route";
import { setLLMClient } from "@/src/ai/llm-client";
import type { RequirementHistory } from "@/src/modules/requirements/history";
import { resetDb } from "@/tests/helpers/context";
import { projectWithTwoChanges } from "@/tests/helpers/requirement-history";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) =>
  historyRoute.GET(new Request("http://localhost/api", { method: "GET" }), params(id));

beforeEach(() => {
  resetDb();
  setLLMClient(undefined);
});

describe("GET /api/projects/:id/requirements/history (PF-056)", () => {
  it("returns the versions of changed requirements with their change requests", async () => {
    const { projectId } = await projectWithTwoChanges();
    const res = await get(projectId);
    expect(res.status).toBe(200);
    const { history } = (await res.json()) as { history: RequirementHistory[] };
    expect(history).toHaveLength(1);
    expect(history[0]!.versions.map((v) => v.change?.code ?? null)).toEqual([
      null,
      "CR-01",
      "CR-02",
    ]);
  });

  it("answers 404 for an unknown project", async () => {
    const res = await get(crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
