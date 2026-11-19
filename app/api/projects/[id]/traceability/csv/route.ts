import { withErrors } from "@/src/lib/http";
import { exportTraceabilityCsv } from "@/src/modules/traceability/service";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/projects/:id/traceability/csv — the matrix as CSV (audit-logged export). */
export const GET = withErrors(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await currentContext();
    const { csv, filename } = await exportTraceabilityCsv(ctx, (await params).id);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
