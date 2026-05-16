// Structured JSON logger. Outputs one line per event so log aggregators
// (Vercel Logs, Datadog, BetterStack) can parse without regex. Falls back
// to plain console in dev for readability.
//
// Usage:
//   log.info("user.login", { userId, role });
//   log.warn("rate.limited", { ip, attempts });
//   log.error("db.failed", { err: err.message });
//
// Avoid logging PII (emails, phone numbers, full names) — log identifiers
// instead so logs can be shared with vendors without redaction.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeMinLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug")) as Level;
  return LEVEL_RANK[raw] ?? 20;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (LEVEL_RANK[level] < activeMinLevel()) return;
  const payload = {
    t: new Date().toISOString(),
    level,
    event,
    env: process.env.NODE_ENV ?? "unknown",
    ...fields,
  };
  if (process.env.NODE_ENV === "production") {
    // JSON line so log scrapers can index by field.
    console.log(JSON.stringify(payload));
  } else {
    // Pretty for dev — drops the timestamp Next already prefixes.
    console.log(`[${level}] ${event}`, fields ?? "");
  }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
