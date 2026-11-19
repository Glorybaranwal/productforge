import * as generatePrdRoute from "@/app/api/projects/[id]/prd/generate/route";
import * as prdStateRoute from "@/app/api/projects/[id]/prd/route";
import * as approvePrdRoute from "@/app/api/prds/[id]/approve/route";
import type { PrdState } from "@/src/modules/prd/service";

import { projectThroughGate1 } from "./discovery";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string) => new Request("http://localhost/api", { method });

/** A project through Gate 2: BRIEF → discovery → Gate 1 → PRD v1 approved. */
export async function projectThroughGate2(): Promise<{ projectId: string }> {
  const { projectId } = await projectThroughGate1();
  await generatePrdRoute.POST(req("POST"), params(projectId));
  const state = (await (await prdStateRoute.GET(req("GET"), params(projectId))).json()) as PrdState;
  const res = await approvePrdRoute.POST(req("POST"), params(state.versions[0]!.id));
  if (res.status !== 200) throw new Error(`Gate 2 failed: ${await res.text()}`);
  return { projectId };
}
