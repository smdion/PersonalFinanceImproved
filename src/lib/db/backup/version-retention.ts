import { storedInteger } from "@/lib/utils/stored-integer";

/** How many auto versions are kept: the stored count (storedInteger), 30
 *  when unset, never under 1 (a 0 would delete every auto version). */
export function versionRetention(raw: unknown): number {
  return Math.max(1, storedInteger(raw, 30));
}
