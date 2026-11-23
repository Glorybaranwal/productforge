import { z } from "zod";

import { logger } from "./logger";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export type FieldError = { path: string; message: string };

/** API error body (CLAUDE.md §8): `{ error: { code, message, details? } }`. */
export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown };
};

/** An expected failure that maps to an HTTP status and a safe message. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** Parses `input` with `schema`, throwing a VALIDATION_ERROR with field details on failure. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Some fields are invalid", zodFieldErrors(result.error));
  }
  return result.data;
}

export function toErrorBody(err: unknown): { status: number; body: ApiErrorBody } {
  if (err instanceof AppError) {
    const error: ApiErrorBody["error"] = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.status, body: { error } };
  }
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid",
          details: zodFieldErrors(err),
        },
      },
    };
  }
  logger.error("Unhandled error", { error: err instanceof Error ? err.message : String(err) });
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
  };
}

/** Seconds a client should wait after a RATE_LIMITED error that doesn't say (PF-084). */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** `retryAfterSeconds` from an error's details when it is a positive whole number, else the default. */
function retryAfterOf(err: unknown): number {
  const details = err instanceof AppError ? err.details : undefined;
  const seconds =
    typeof details === "object" && details !== null
      ? (details as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds > 0
    ? seconds
    : DEFAULT_RETRY_AFTER_SECONDS;
}

export function errorResponse(err: unknown): Response {
  const { status, body } = toErrorBody(err);
  // Every 429 carries Retry-After so a well-behaved client can back off. Only here, not in
  // toErrorBody: src/lib/supabase/proxy.ts builds error bodies without going through errorResponse.
  const headers =
    body.error.code === "RATE_LIMITED" ? { "Retry-After": String(retryAfterOf(err)) } : undefined;
  return Response.json(body, { status, headers });
}
