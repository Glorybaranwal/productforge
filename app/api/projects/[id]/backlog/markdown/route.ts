import { withErrors } from "@/src/lib/http";
import { getBacklogMarkdown } from "@/src/modules/stories/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/backlog/markdown — approved stories as a Markdown file. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { markdown, filename } = await getBacklogMarkdown(ctx, (await params).id);
    return new Response(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
