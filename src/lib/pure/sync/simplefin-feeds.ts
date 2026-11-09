/**
 * Which SimpleFIN accounts count as a live feed: linked and "included". An unchecked account stays
 * linked but every total, comparison, fill and check ignores it, so its tracked account goes by its
 * manual snapshot balance.
 */
export function countsAsFeed(a: {
  linkedPerformanceAccountId: number | null;
  isIncluded: boolean;
}): boolean {
  return a.linkedPerformanceAccountId != null && a.isIncluded;
}

/** Unlinked and owing: a loan or card nothing has claimed yet. It's flagged
 *  for linking, not added to the total as if it were money. */
export function isUnclaimedDebt(a: {
  linkedLoanId: number | null;
  linkedPerformanceAccountId: number | null;
  lastBalance: number | string;
}): boolean {
  return (
    a.linkedLoanId == null &&
    a.linkedPerformanceAccountId == null &&
    Number(a.lastBalance) < 0
  );
}

/** Whether a feed's balance adds to the live total. A loan's is a debt
 *  Ledgr already holds on the loan, not money. */
export function countsInLiveBalance(a: {
  linkedLoanId: number | null;
  linkedPerformanceAccountId: number | null;
  lastBalance: number | string;
  isIncluded: boolean;
}): boolean {
  return a.isIncluded && a.linkedLoanId == null && !isUnclaimedDebt(a);
}

/** Servicers report about monthly: a loan feed older than this is flagged,
 *  and keeps its last real balance (the schedule would move net worth). */
export const LOAN_FEED_STALE_DAYS = 45;

export function loanFeedIsStale(asOf: Date | string, now: Date): boolean {
  const ageMs = now.getTime() - new Date(asOf).getTime();
  return ageMs > LOAN_FEED_STALE_DAYS * 86_400_000;
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
 * Whether live balance covers the whole account as the snapshot does: it has feeds, every part is
 * linked (or a feed covers the whole account), and no feed's money sits outside a part.
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
 * The portfolio estimated for each day after a snapshot: the snapshot total plus, per covered
 * account, live balance minus snapshot amount, once all its feeds have a balance by that day.
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
