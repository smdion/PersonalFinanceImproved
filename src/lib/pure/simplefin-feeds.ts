/**
 * Which SimpleFIN accounts count as a live feed for a tracked account.
 * Pure.
 *
 * Linking says which tracked account a SimpleFIN account is; the
 * "included" checkbox says whether it counts at all. An unchecked account
 * stays linked (so re-checking it restores everything) but is ignored by
 * every total, comparison, fill and check — its tracked account then goes
 * by its manual snapshot balance. One rule, used everywhere.
 */
export function countsAsFeed(a: {
  linkedPerformanceAccountId: number | null;
  isIncluded: boolean;
}): boolean {
  return a.linkedPerformanceAccountId != null && a.isIncluded;
}

/**
 * How far back "recent" SimpleFIN activity reaches (SimpleFIN keeps about
 * this much history): the deposit check's window, and how long a feed may
 * go without sending a transaction before it counts as balance-only.
 */
export const RECENT_ACTIVITY_DAYS = 90;

/**
 * Whether any of `feedIds` sent a transaction on or after `since` (or ever,
 * without `since`). `lastTransactionDay`: each feed's latest posted day.
 */
export function sentTransactions(
  feedIds: readonly number[],
  lastTransactionDay: ReadonlyMap<number, string>,
  since?: string,
): boolean {
  return feedIds.some((id) => {
    const last = lastTransactionDay.get(id);
    return last !== undefined && (since === undefined || last >= since);
  });
}

/**
 * Whether an account's live balance covers the whole account the way the
 * snapshot does, so the two can be compared: it has feeds, every part of
 * it is linked (or a feed covers the whole account), and no feed's money
 * sits outside a part.
 */
export function liveCoversAccount(
  partKeys: readonly string[],
  feedSubKeys: readonly (string | null)[],
  unplacedFeeds: number,
): boolean {
  if (feedSubKeys.length === 0 || partKeys.length === 0) return false;
  if (unplacedFeeds > 0) return false;
  return (
    feedSubKeys.includes(null) || partKeys.every((k) => feedSubKeys.includes(k))
  );
}

/**
 * The household's portfolio estimated for each day after a snapshot:
 * the snapshot total plus, for every account whose live balance covers it,
 * that day's live balance minus its snapshot amount. A day counts an
 * account only once all its feeds have a balance on or before that day.
 */
export function dailyEstimates(
  days: readonly string[],
  snapshotTotal: number,
  accounts: readonly {
    snapshotAmount: number;
    /** Per feed: [day, balance] ascending. */
    feedHistories: readonly (readonly [string, number])[][];
  }[],
): { date: string; total: number; accounts: number }[] {
  const asOf = (h: readonly (readonly [string, number])[], day: string) => {
    let v: number | null = null;
    for (const [d, b] of h) {
      if (d > day) break;
      v = b;
    }
    return v;
  };
  return days.map((day) => {
    let total = snapshotTotal;
    let counted = 0;
    for (const a of accounts) {
      const balances = a.feedHistories.map((h) => asOf(h, day));
      if (balances.some((b) => b === null)) continue;
      total += balances.reduce<number>((t, b) => t + b!, 0) - a.snapshotAmount;
      counted++;
    }
    return {
      date: day,
      total: Math.round(total * 100) / 100,
      accounts: counted,
    };
  });
}
