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
  /pass(word)?|secret|token|api[-_]?key|authori[sz]ation|cookie|service[-_]?role|private[-_]?key/i;
/** Values that look like credentials wherever they appear: OpenAI/Supabase/ProductForge API keys, JWTs, bearer tokens. */
const SECRET_VALUE =
  /\b(sk-[A-Za-z0-9_-]{16,}|pf_(live|test)_[a-z2-7]{8}_[A-Za-z0-9_-]{16,}|sb_(secret|publishable)_[A-Za-z0-9_-]{8,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|Bearer\s+[\w.-]{16,})/g;
/** Longer strings are cut: document text and prompts don't belong in logs. */
export const MAX_LOGGED_STRING = 300;
const MAX_DEPTH = 4;

/** What a log line may hold: secrets masked, long text cut, errors reduced to name and message. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const masked = value.replace(SECRET_VALUE, "[redacted]");
    return masked.length > MAX_LOGGED_STRING
      ? `${masked.slice(0, MAX_LOGGED_STRING)}…[+${masked.length - MAX_LOGGED_STRING} chars]`
      : masked;
  }
  if (value instanceof Error)
    return { name: value.name, message: redact(value.message, depth + 1) };
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
