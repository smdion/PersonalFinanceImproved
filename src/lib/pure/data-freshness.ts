/**
 * Pure helper for the sidebar's "Data Updated" freshness indicator.
 */

/**
 * Given a set of raw date strings from different sources (some date-only
 * like "2026-08-01", some full ISO timestamps like the JSON-serialized
 * form of a Date), returns the raw string of the chronologically oldest
 * one — or null if none are valid.
 *
 * Returns the WINNING source's original raw string, not a reconstructed
 * Date, so callers can format it with `formatDate()` directly. formatDate
 * treats a date-only string as local midnight but a string containing "T"
 * as an absolute instant; reconstructing via `new Date(...).toISOString()`
 * always produces a "T"-containing string, which would silently push a
 * date-only winner onto the wrong branch and shift it a day in
 * negative-UTC-offset timezones.
 */
export function findOldestDateSource(
  rawDates: (string | null | undefined)[],
): string | null {
  const parse = (raw: string) =>
    new Date(raw.includes("T") ? raw : raw + "T00:00:00").getTime();

  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const raw of rawDates) {
    if (!raw) continue;
    const t = parse(raw);
    if (Number.isNaN(t)) continue;
    if (t < oldestTime) {
      oldest = raw;
      oldestTime = t;
    }
  }
  return oldest;
}
