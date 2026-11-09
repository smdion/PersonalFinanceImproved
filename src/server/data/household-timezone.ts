/**
 * The household's time zone (the `household_timezone` setting, else the container TZ):
 * sets `process.env.TZ`, so every server-side "today" and date-only boundary follows it.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { SK_HOUSEHOLD_TIMEZONE } from "@/lib/constants/settings-keys";
import type { Db } from "@/lib/db";

/** The container's own zone, before any household setting applied. */
const containerTimeZone = process.env.TZ;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Run server date math in `tz`; null/invalid falls back to the container's zone. */
export function applyHouseholdTimeZone(tz: unknown): void {
  const next = isValidTimeZone(tz) ? tz : containerTimeZone;
  if (process.env.TZ === next) return;
  if (next === undefined) delete process.env.TZ;
  else process.env.TZ = next;
  log("info", "household_timezone_applied", { timeZone: next ?? "UTC" });
}

/** Apply the saved household zone (server start). Never throws.
 *  @public — loaded by instrumentation.node.ts's dynamic import, which knip can't follow. */
export async function loadHouseholdTimeZone(db: Db): Promise<void> {
  try {
    const [row] = await db
      .select({ value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SK_HOUSEHOLD_TIMEZONE))
      .limit(1);
    applyHouseholdTimeZone(row?.value ?? null);
  } catch (e) {
    log("warn", "household_timezone_load_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
