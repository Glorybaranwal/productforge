import { z } from "zod";
import { describe, expect, it } from "vitest";

import { AppError, parseOrThrow, toErrorBody } from "@/src/lib/errors";

describe("toErrorBody", () => {
  it("maps an AppError to its status and the standard error shape", () => {
    const { status, body } = toErrorBody(new AppError("NOT_FOUND", "Project not found"));
    expect(status).toBe(404);
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "Project not found" } });
  });

  it("turns a ZodError into a 400 with field details", () => {
    const result = z.object({ name: z.string().min(2) }).safeParse({ name: "x" });
    if (result.success) throw new Error("expected failure");
    const { status, body } = toErrorBody(result.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toMatchObject([{ path: "name" }]);
  });

  it("hides unexpected errors behind a generic 500", () => {
    const { status, body } = toErrorBody(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("hunter2");
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data when valid", () => {
    expect(parseOrThrow(z.object({ n: z.coerce.number() }), { n: "3" })).toEqual({ n: 3 });
  });

  it("throws a VALIDATION_ERROR listing each invalid field", () => {
    try {
      parseOrThrow(z.object({ a: z.string(), b: z.number() }), {});
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appError = err as AppError;
      expect(appError.code).toBe("VALIDATION_ERROR");
      expect((appError.details as { path: string }[]).map((d) => d.path)).toEqual(["a", "b"]);
    }
  });
});
