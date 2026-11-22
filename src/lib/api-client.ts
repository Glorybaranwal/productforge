/** Browser-side helper for calling our REST API. Safe to import from client components. */

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors: FieldErrors;

  constructor(code: string, message: string, status: number, fieldErrors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** First message per field from `[{ path, message }]` (the API's validation details). */
export function toFieldErrors(details: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(details)) return errors;
  for (const item of details) {
    const { path, message } = (item ?? {}) as { path?: unknown; message?: unknown };
    const key = typeof path === "string" && path ? path : "_form";
    if (typeof message === "string" && !(key in errors)) errors[key] = message;
  }
  return errors;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: {
        // A FormData body sets its own multipart content type.
        ...(options.body === undefined || options.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined || options.body instanceof FormData
          ? (options.body as FormData | undefined)
          : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("NETWORK", "Couldn't reach the server. Check your connection.", 0);
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;

  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "Something went wrong. Please try again.",
      response.status,
      toFieldErrors(error?.details),
    );
  }
  return data as T;
}
