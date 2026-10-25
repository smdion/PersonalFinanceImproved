/**
 * Dismissed and snoozed recommendations — household-wide (app_settings
 * `recommendation_dismissals`, admin-written, validated on write with
 * `dismissalsSchema`). A dismissal remembers the urgency it was made at:
 * if the recommendation escalates (soon → now) it comes back.
 */
import { z } from "zod/v4";
import { localDateStr } from "@/lib/utils/date";
import type {
  Recommendation,
  RecommendationUrgency,
} from "@/lib/pure/recommendations";

const URGENCY_RANK: Record<RecommendationUrgency, number> = {
  now: 0,
  soon: 1,
};

const dismissalIdSchema = z.string().min(1).max(80);
const dismissalSchema = z.object({
  /** Hidden until this date (YYYY-MM-DD); null = for good. */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** The urgency when dismissed. */
  urgency: z.enum(["now", "soon"]),
  /** Why — the household's own note. */
  note: z.string().trim().max(280).optional(),
  /** When it was dismissed or snoozed (YYYY-MM-DD). */
  on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export const dismissalsSchema = z.record(dismissalIdSchema, dismissalSchema);
export type Dismissals = z.infer<typeof dismissalsSchema>;

export function parseDismissals(raw: unknown): Dismissals {
  // Entry by entry: one bad entry (a hand-edited date) drops only itself,
  // not every dismissal and snooze the household has.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Dismissals = {};
  for (const [id, value] of Object.entries(raw)) {
    const entry = dismissalSchema.safeParse(value);
    if (dismissalIdSchema.safeParse(id).success && entry.success) {
      out[id] = entry.data;
    }
  }
  return out;
}

function isActive(d: Dismissals[string], today: string): boolean {
  return d.until === null || d.until > today;
}

/** Splits recommendations into shown and dismissed. `today` is the
 *  household's date (YYYY-MM-DD). */
export function applyDismissals(
  recommendations: readonly Recommendation[],
  dismissals: Dismissals,
  today: string,
): { shown: Recommendation[]; dismissed: Recommendation[] } {
  const shown: Recommendation[] = [];
  const dismissed: Recommendation[] = [];
  for (const r of recommendations) {
    const d = dismissals[r.id];
    const hidden =
      d !== undefined &&
      isActive(d, today) &&
      !(r.snoozeOnly && d.until === null) &&
      URGENCY_RANK[r.urgency] >= URGENCY_RANK[d.urgency];
    (hidden ? dismissed : shown).push(r);
  }
  return { shown, dismissed };
}

/** The dismissals to save: expired snoozes dropped, `change` applied
 *  (null removes the entry — "restore"). */
export function nextDismissals(
  current: Dismissals,
  today: string,
  change: { id: string; value: Dismissals[string] | null },
): Dismissals {
  const out: Dismissals = {};
  for (const [id, d] of Object.entries(current))
    if (isActive(d, today) && id !== change.id) out[id] = d;
  if (change.value) out[change.id] = change.value;
  return out;
}

/** A snooze end date `months` from `today` (YYYY-MM-DD). */
export function snoozeUntil(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  // Clamp to the target month's last day: Jan 31 + 1 month is Feb 28/29,
  // not Mar 3 (Date rolls the overflow into the next month).
  const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
  return localDateStr(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}
