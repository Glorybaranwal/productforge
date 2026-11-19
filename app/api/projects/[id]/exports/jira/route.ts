import { readJson, withErrors } from "@/src/lib/http";
import { exportJira } from "@/src/modules/exports/service";
import { currentContext } from "@/src/modules/workspaces/service";

/**
 * POST /api/projects/:id/exports/jira — `{ format: "csv" | "json", target: "cloud" | "datacenter",
 * includeTasks, subtaskType }` → the approved backlog as a Jira import file. Audit-logged.
 * 409 when no story is approved yet.
 */
export const POST = withErrors(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { body, filename, contentType } = await exportJira(
      ctx,
      (await params).id,
      await readJson(request),
    );
    return new Response(body, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
