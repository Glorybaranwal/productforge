import { withErrors } from "@/src/lib/http";
import { getPrdMarkdown } from "@/src/modules/prd/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/prds/:id/markdown — the PRD as a Markdown file download. */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { markdown, filename } = await getPrdMarkdown(ctx, (await params).id);
    return new Response(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
