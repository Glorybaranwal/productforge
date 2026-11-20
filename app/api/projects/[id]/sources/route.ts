import { readJson, withErrors } from "@/src/lib/http";
import { AppError } from "@/src/lib/errors";
import { addSource, addUploadedSource, listSources } from "@/src/modules/sources/service";
import { currentContext } from "@/src/modules/workspaces/service";

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/sources */
export const GET = withErrors(async (_request: Request, { params }: Context) => {
  const ctx = await currentContext();
  return Response.json({ sources: await listSources(ctx, (await params).id) });
});

/**
 * POST /api/projects/:id/sources — JSON `{ name, kind: "paste" | "file", text }`, or a multipart
 * upload with one `file` (PDF, .docx, .txt, .md; PF-023) whose text is extracted on the server.
 * 201 with `{ source }` (+ `truncated`, `pages` for uploads).
 */
export const POST = withErrors(async (request: Request, { params }: Context) => {
  const ctx = await currentContext();
  const projectId = (await params).id;
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Attach a file to upload");
    const result = await addUploadedSource(ctx, projectId, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json(result, { status: 201 });
  }
  const source = await addSource(ctx, projectId, await readJson(request));
  return Response.json({ source }, { status: 201 });
});
