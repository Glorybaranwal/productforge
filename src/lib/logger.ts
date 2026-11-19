type Level = "debug" | "info" | "warn" | "error";
type Meta = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const env = typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return typeof process !== "undefined" && process.env?.NODE_ENV === "test" ? "error" : "info";
}

function write(level: Level, message: string, meta?: Meta): void {
  if (ORDER[level] < ORDER[minLevel()]) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Structured JSON logger. Never pass secrets or raw document text in `meta`. */
export const logger = {
  debug: (message: string, meta?: Meta) => write("debug", message, meta),
  info: (message: string, meta?: Meta) => write("info", message, meta),
  warn: (message: string, meta?: Meta) => write("warn", message, meta),
  error: (message: string, meta?: Meta) => write("error", message, meta),
};
