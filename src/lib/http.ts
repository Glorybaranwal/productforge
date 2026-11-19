import { AppError, errorResponse } from "./errors";

/** Reads a JSON request body, or throws a VALIDATION_ERROR if it isn't valid JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

/**
 * Wraps a route handler so thrown errors become the standard error response.
 * Route handlers stay thin: auth context → service call → JSON (CLAUDE.md §6).
 */
export function withErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
