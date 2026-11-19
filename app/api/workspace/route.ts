import { withErrors } from "@/src/lib/http";
import { currentContext } from "@/src/modules/workspaces/service";

/** GET /api/workspace — the caller's workspace, role and user (creates the workspace on first visit). */
export const GET = withErrors(async () => {
  const { workspace, role, session } = await currentContext();
  return Response.json({ workspace, role, user: { id: session.userId, name: session.name } });
});
