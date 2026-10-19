/**
 * Recent balance change over fixed windows (1 / 7 / 30 / 90 days) from the
 * stored daily balances — a raw change that includes deposits and
 * withdrawals (no percentage: without flows it isn't a return).
 *
 * Per feed: the last balance of its latest day vs the last balance on or
 * before that day minus N. A window is shown for a group only once every
 * feed in it reaches back that far, with the real "since" date (the
 * earliest base day used). Pure — no DB.
 */
import { addDays } from "@/lib/utils/date";
import { roundToCents } from "@/lib/utils/math";

export type DailyBalance = { day: string; balance: number };

export type WindowChange = {
  days: number;
  /** null until every feed in the group reaches back this far. */
  change: number | null;
  /** The earliest base day used (null when not covered). */
  since: string | null;
};

function feedChange(rows: readonly DailyBalance[], days: number) {
  const latest = rows[rows.length - 1];
  if (!latest) return null;
  const target = addDays(latest.day, -days);
  let base: DailyBalance | undefined;
  for (const r of rows) {
    if (r.day > target) break;
    base = r;
  }
  return base
    ? { change: latest.balance - base.balance, since: base.day }
    : null;
}

/** One group (an account, or the household) of feeds' histories, each sorted by day ascending. */
export function recentChanges(
  histories: readonly (readonly DailyBalance[])[],
  windows: readonly number[],
): WindowChange[] {
  const withData = histories.filter((h) => h.length > 0);
  return windows.map((days) => {
    if (withData.length === 0) return { days, change: null, since: null };
    const parts = withData.map((h) => feedChange(h, days));
    if (parts.some((p) => p === null))
      return { days, change: null, since: null };
    return {
      days,
      change: roundToCents(parts.reduce((s, p) => s + p!.change, 0)),
      since: parts.map((p) => p!.since).sort()[0]!,
    };
  });
}
