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
