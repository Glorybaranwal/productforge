import { AppError } from "./errors";

/**
 * Strongest first. The order is load-bearing: `effectiveRole` takes the later of two roles as the
 * lower one, so reordering this silently changes what an API key may do. Pinned by a test.
 */
export const ROLES = ["owner", "admin", "pm", "developer", "qa"] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to create, approve and delete (PRD: only Owner/Admin/PM approve). */
export const MANAGER_ROLES: readonly Role[] = ["owner", "admin", "pm"];

/**
 * The role a request acts with: the lower of what the API key's scope allows and what the member
 * is now (ADR-036). A `read` key lands on the lowest role, which no manager-only check accepts; a
 * `write` key keeps the member's role and never gains one.
 */
export function effectiveRole(scope: "read" | "write", memberRole: Role): Role {
  const ceiling: Role = scope === "read" ? ROLES[ROLES.length - 1]! : ROLES[0]!;
  return ROLES.indexOf(memberRole) >= ROLES.indexOf(ceiling) ? memberRole : ceiling;
}

export type Session = { userId: string; name: string; email: string };

/** Demo mode (ADR-011): a single local user, no sign-in. The real session is in `session.ts`. */
export const DEMO_USER: Session = {
  userId: "00000000-0000-4000-8000-000000000001",
  name: "Demo PM",
  email: "demo@productforge.local",
};

export function requireRole(role: Role, allowed: readonly Role[], action: string): void {
  if (!allowed.includes(role)) {
    throw new AppError("FORBIDDEN", `Your role (${role}) can't ${action}`);
  }
}

/**
 * No API key can approve or confirm anything: APPROVED is reserved for a user action (CLAUDE.md
 * §7.7, ADR-036). Call it first in every service that moves a row to APPROVED, before the role check,
 * so an owner's key is refused too. `viaApiKey` is set only by `contextForApiKey`.
 */
export function refuseApiKeyApproval(ctx: { viaApiKey?: true }): void {
  if (ctx.viaApiKey)
    throw new AppError("FORBIDDEN", "API keys can't approve or confirm; a person must do this");
}
