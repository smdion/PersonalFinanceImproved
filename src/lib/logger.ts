import { writeStamp } from "@/lib/utils/clock";

type LogLevel = "info" | "warn" | "error";

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
) {
  const entry = {
    timestamp: writeStamp().toISOString(),
    level,
    event,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

const warnedOnce = new Set<string>();

/** A warning logged once per process per event and key, not on every call:
 *  a stored row read on every request would otherwise warn on each. */
export function logWarnOnce(
  event: string,
  key: string,
  data?: Record<string, unknown>,
) {
  const seen = `${event}\0${key}`;
  if (warnedOnce.has(seen)) return;
  warnedOnce.add(seen);
  log("warn", event, data);
}
