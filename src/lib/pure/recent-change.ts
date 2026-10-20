/**
 * Recent balance change over fixed windows (1 / 7 / 30 / 90 days) from the
 * stored daily balances — a raw change that includes deposits and
 * withdrawals (no percentage: without flows it isn't a return).
 *
 * Every feed in a group is measured over the same dates: from the group's
 * latest day back N days — each feed's last balance on or before the end
 * vs its last on or before the start. A feed that stopped reporting
 * before the window contributes no change (its balance is the same at
 * both ends). A window is shown only once every feed reaches back that
 * far, with the real "since" date (the earliest base day used). Pure.
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

function lastOnOrBefore(rows: readonly DailyBalance[], day: string) {
  let found: DailyBalance | undefined;
  for (const r of rows) {
    if (r.day > day) break;
    found = r;
  }
  return found;
}

function feedChange(rows: readonly DailyBalance[], end: string, days: number) {
  const latest = lastOnOrBefore(rows, end);
  const base = lastOnOrBefore(rows, addDays(end, -days));
  return latest && base
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
    const end = withData
      .map((h) => h[h.length - 1]!.day)
      .sort()
      .at(-1)!;
    const parts = withData.map((h) => feedChange(h, end, days));
    if (parts.some((p) => p === null))
      return { days, change: null, since: null };
    return {
      days,
      change: roundToCents(parts.reduce((s, p) => s + p!.change, 0)),
      since: parts.map((p) => p!.since).sort()[0]!,
    };
  });
}
