/**
 * When each milestone was first reached (`milestone_first_reached`). Ones already reached at
 * `since` have no date unless history dates them; only later ones are "new". Never unrecorded.
 */
import { z } from "zod/v4";

/** Days a newly reached milestone is marked "New". */
export const FIRST_REACHED_NEW_DAYS = 30;

const dayOrYear = z.string().regex(/^\d{4}(-\d{2}-\d{2})?$/);

export const firstReachedSchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** id → "YYYY-MM-DD" (seen reached that day), "YYYY" (dated by the
   *  yearly history), or "" (reached before recording began). */
  reached: z.record(
    z.string().min(1).max(60),
    z.union([dayOrYear, z.literal("")]),
  ),
});
export type FirstReached = z.infer<typeof firstReachedSchema>;

export function parseFirstReached(raw: unknown): FirstReached | null {
  const parsed = firstReachedSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Add the milestones reached now that aren't recorded yet; never changes
 *  a recorded one. Null when nothing changes. */
export function mergeFirstReached(
  existing: FirstReached | null,
  reachedNow: readonly { id: string; reachedYear: number | null }[],
  today: string,
): FirstReached | null {
  const asOfYear = Number(today.slice(0, 4));
  const first = existing === null;
  const next: FirstReached = existing
    ? { since: existing.since, reached: { ...existing.reached } }
    : { since: today, reached: {} };
  let changed = first;
  for (const { id, reachedYear } of reachedNow) {
    if (id in next.reached) continue;
    next.reached[id] =
      reachedYear !== null && reachedYear < asOfYear
        ? String(reachedYear)
        : first
          ? ""
          : today;
    changed = true;
  }
  return changed ? next : null;
}

/** A full date after recording began, within the "New" window. */
export function isNewlyReached(
  record: FirstReached | null | undefined,
  id: string,
  today: string,
): boolean {
  const date = record?.reached[id];
  if (!date || date.length !== 10) return false;
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
    86_400_000;
  return days >= 0 && days < FIRST_REACHED_NEW_DAYS;
}
