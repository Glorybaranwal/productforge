import { AppError } from "./errors";

export const ROLES = ["owner", "admin", "pm", "developer", "qa"] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to create, approve and delete (PRD: only Owner/Admin/PM approve). */
export const MANAGER_ROLES: readonly Role[] = ["owner", "admin", "pm"];

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
