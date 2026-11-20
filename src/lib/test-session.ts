import type { Session } from "./auth";

let override: Session | null = null;

/**
 * Tests only: who the demo-mode session is, so one test can act as two users in two workspaces
 * (tenant and role matrix, ADR-035). Ignored outside `NODE_ENV=test`.
 */
export function actAs(session: Session | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("actAs is for tests only");
  override = session;
}

export const testSession = (): Session | null =>
  process.env.NODE_ENV === "test" ? override : null;
