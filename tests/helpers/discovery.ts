import * as confirmRoute from "@/app/api/projects/[id]/discovery/confirm/route";
import * as discoveryRoute from "@/app/api/projects/[id]/discovery/route";
import * as sourcesRoute from "@/app/api/projects/[id]/sources/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as questionRoute from "@/app/api/questions/[id]/route";
import type { DiscoveryState } from "@/src/modules/requirements/discovery-service";

import { validProject } from "./context";

export const BRIEF =
  "Customers can view transactions, filter them, download reports, and receive notifications for failed transactions. " +
  "It must be really fast.\nOpen: not sure yet whether business accounts are in scope.";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Creates a project, runs discovery on BRIEF and passes Gate 1 (answers the channel question, skips the rest). */
export async function projectThroughGate1(): Promise<{ projectId: string; state: DiscoveryState }> {
  const { project } = (await (await projectsRoute.POST(req("POST", validProject))).json()) as {
    project: { id: string };
  };
  await sourcesRoute.POST(req("POST", { name: "Brief", text: BRIEF }), params(project.id));
  await discoveryRoute.POST(req("POST"), params(project.id));
  let state = (await (
    await discoveryRoute.GET(req("GET"), params(project.id))
  ).json()) as DiscoveryState;
  for (const q of state.questions.filter((q) => q.state === "open")) {
    const body = /channel/i.test(q.question)
      ? { state: "answered", answer: "Email and push" }
      : { state: "skipped" };
    await questionRoute.PATCH(req("PATCH", body), params(q.id));
  }
  const confirmed = await confirmRoute.POST(req("POST"), params(project.id));
  if (confirmed.status !== 200) throw new Error(`Gate 1 failed: ${await confirmed.text()}`);
  state = (await confirmed.json()) as DiscoveryState;
  return { projectId: project.id, state };
}
