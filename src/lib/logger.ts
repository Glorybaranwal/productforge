type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const env = typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return typeof process !== "undefined" && process.env?.NODE_ENV === "test" ? "error" : "info";
}

/** Keys whose values are never logged (ADR-035). */
const SECRET_KEY =
  /pass(word)?|secret|plaintext|token|api[-_]?key|authori[sz]ation|cookie|service[-_]?role|private[-_]?key/i;
/** Values that look like credentials wherever they appear: OpenAI/Supabase/ProductForge API keys, JWTs, bearer tokens. */
const SECRET_VALUE =
  /\b(sk-[A-Za-z0-9_-]{16,}|pf_(live|test)_[a-z2-7]{8}_[A-Za-z0-9_-]{16,}|sb_(secret|publishable)_[A-Za-z0-9_-]{8,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|Bearer\s+[\w.-]{16,})/g;
/** Longer strings are cut: document text and prompts don't belong in logs. */
export const MAX_LOGGED_STRING = 300;
const MAX_DEPTH = 4;

/**
 * A message that is safe to log for any caught value. Drizzle wraps a failed query in an error whose
 * message is `Failed query: <sql>\nparams: <values>`, so it carries every bound parameter: user ids,
 * API key ids, row contents. Neither the logger's cut nor its credential patterns remove those (a uuid
 * is not credential-shaped, and the params start inside the first 300 characters), so this reports the
 * underlying cause instead (the driver's own error, which names the failure without the values), or
 * just "Query failed" when there is none. Use it, not `err.message` or `String(err)`, in a `logger` call.
 */
export function safeErrorMessage(err: unknown): string {
  let current = err;
  // Unwrap nested wrappers, with a bound so a cause cycle can't loop forever.
  for (
    let i = 0;
    i < 5 && current instanceof Error && /^Failed query:/.test(current.message);
    i += 1
  )
    current = current.cause;
  if (current instanceof Error) {
    return /^Failed query:/.test(current.message) ? "Query failed" : current.message;
  }
  if (err instanceof Error) return "Query failed";
  return typeof err === "string" ? err : "Unknown error";
}

/** What a log line may hold: secrets masked, long text cut, errors reduced to name and message. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const masked = value.replace(SECRET_VALUE, "[redacted]");
    return masked.length > MAX_LOGGED_STRING
      ? `${masked.slice(0, MAX_LOGGED_STRING)}…[+${masked.length - MAX_LOGGED_STRING} chars]`
      : masked;
  }
  if (value instanceof Error)
    return { name: value.name, message: redact(safeErrorMessage(value), depth + 1) };
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1),
    ]),
  );
}

function write(level: Level, message: string, meta?: Meta): void {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const safe = meta ? (redact(meta) as Meta) : undefined;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: redact(message),
    ...safe,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Structured JSON logger. Still never pass secrets or raw document text in `meta`: `redact` is the
 * safety net, not the rule.
 */
export const logger = {
  debug: (message: string, meta?: Meta) => write("debug", message, meta),
  info: (message: string, meta?: Meta) => write("info", message, meta),
  warn: (message: string, meta?: Meta) => write("warn", message, meta),
  error: (message: string, meta?: Meta) => write("error", message, meta),
};
