import { describe, expect, it } from "vitest";

import { AppError } from "@/src/lib/errors";
import {
  effectiveRole,
  MANAGER_ROLES,
  refuseApiKeyApproval,
  requireRole,
  ROLES,
  type Role,
} from "@/src/lib/auth";

const rank = (role: Role) => ROLES.indexOf(role); // 0 = owner (highest) ... 4 = qa (lowest)
const refuses = (role: Role, allowed: readonly Role[]) => {
  try {
    requireRole(role, allowed, "do it");
    return false;
  } catch {
    return true;
  }
};

describe("ROLES order", () => {
  it("is strongest first, because effectiveRole depends on it", () => {
    // The other effectiveRole tests compute rank from ROLES.indexOf, so they hold under any order;
    // this is the one that pins it.
    expect([...ROLES]).toEqual(["owner", "admin", "pm", "developer", "qa"]);
    expect(ROLES[0]).toBe("owner");
    expect(ROLES.at(-1)).toBe("qa");
  });
});

describe("effectiveRole (PF-083, ADR-036)", () => {
  it("a read key always lands on qa, whatever the member is", () => {
    for (const role of ROLES) expect(effectiveRole("read", role)).toBe("qa");
  });

  it("a write key keeps the member's role", () => {
    for (const role of ROLES) expect(effectiveRole("write", role)).toBe(role);
  });

  it("the table: scope x role", () => {
    const table = Object.fromEntries(
      (["read", "write"] as const).map((scope) => [
        scope,
        Object.fromEntries(ROLES.map((role) => [role, effectiveRole(scope, role)])),
      ]),
    );
    expect(table).toEqual({
      read: { owner: "qa", admin: "qa", pm: "qa", developer: "qa", qa: "qa" },
      write: { owner: "owner", admin: "admin", pm: "pm", developer: "developer", qa: "qa" },
    });
  });

  it("a key never grants a role its owner does not have", () => {
    for (const scope of ["read", "write"] as const)
      for (const role of ROLES)
        expect(rank(effectiveRole(scope, role))).toBeGreaterThanOrEqual(rank(role));
  });

  it("a read key is refused by every manager-only and owner/admin-only check", () => {
    for (const role of ROLES) {
      expect(refuses(effectiveRole("read", role), MANAGER_ROLES)).toBe(true);
      expect(refuses(effectiveRole("read", role), ["owner", "admin"])).toBe(true);
    }
  });

  it("a write key passes exactly the checks its member passes", () => {
    for (const role of ROLES) {
      expect(refuses(effectiveRole("write", role), MANAGER_ROLES)).toBe(
        refuses(role, MANAGER_ROLES),
      );
      expect(refuses(effectiveRole("write", role), ["owner", "admin"])).toBe(
        refuses(role, ["owner", "admin"]),
      );
    }
  });
});

describe("refuseApiKeyApproval", () => {
  it("throws FORBIDDEN (403) for a key-derived context", () => {
    try {
      refuseApiKeyApproval({ viaApiKey: true });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("FORBIDDEN");
      expect((err as AppError).status).toBe(403);
    }
  });

  it("lets a context from a person's sign-in through", () => {
    expect(() => refuseApiKeyApproval({})).not.toThrow();
    expect(() => refuseApiKeyApproval({ viaApiKey: undefined })).not.toThrow();
  });
});
