import { beforeEach, describe, expect, it } from "vitest";

import * as activityRoute from "@/app/api/projects/[id]/activity/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as projectsRoute from "@/app/api/projects/route";
import { resetDb, validProject } from "@/tests/helpers/context";

const BASE = "http://localhost/api/projects";

function json(method: string, body: unknown, url = BASE): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => resetDb());

describe("/api/projects", () => {
  it("runs the full create → list → read → update → activity → delete flow", async () => {
    const created = await projectsRoute.POST(json("POST", validProject));
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: string; name: string } };
    expect(project.name).toBe(validProject.name);

    const list = await projectsRoute.GET();
    expect(((await list.json()) as { projects: unknown[] }).projects).toHaveLength(1);

    const read = await projectRoute.GET(new Request(`${BASE}/${project.id}`), params(project.id));
    expect(read.status).toBe(200);

    const patched = await projectRoute.PATCH(
      json("PATCH", { name: "Payments dashboard" }, `${BASE}/${project.id}`),
      params(project.id),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { project: { name: string } }).project.name).toBe(
      "Payments dashboard",
    );

    const activity = await activityRoute.GET(new Request(BASE), params(project.id));
    const entries = ((await activity.json()) as { activity: { action: string }[] }).activity;
    expect(entries.map((e) => e.action)).toEqual(["project.updated", "project.created"]);

    const removed = await projectRoute.DELETE(new Request(BASE), params(project.id));
    expect(removed.status).toBe(204);

    const gone = await projectRoute.GET(new Request(BASE), params(project.id));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Project not found" },
    });
  });

  it("returns 400 with field details for invalid input", async () => {
    const res = await projectsRoute.POST(json("POST", { ...validProject, teamSize: 0, name: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((d) => d.path).sort()).toEqual(["name", "teamSize"]);
  });

  it("returns 400 when the body is not JSON", async () => {
    const res = await projectsRoute.POST(
      new Request(BASE, {
        method: "POST",
        body: "not json",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await projectRoute.PATCH(json("PATCH", { teamSize: 3 }), params("missing"));
    expect(res.status).toBe(404);
  });
});
