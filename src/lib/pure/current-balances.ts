/**
 * The most accurate balance Ledgr can give each tracked account, part by
 * part (a part's money is never pooled with another's), from the newest of
 * what it knows:
 *
 * - the snapshot, unless a feed's data is from a later market close: the
 *   household's own figures are the most accurate for their day, and
 *   feeds lag a day or two — a feed on the snapshot's own close, or
 *   behind it, says nothing new;
 * - the feed, once its data is from a later close than the snapshot;
 * - either one rolled forward to the target close (the latest every
 *   ticker fund has a price for) by each fund's own total-return price
 *   moves, marked as an estimate. Holdings without a price stay at the
 *   base figure, and the roll says it's partial.
 *
 * Only accounts whose feed has caught up to the snapshot are compared with
 * it. Nothing here is ever written to a snapshot or to Performance.
 */
import {
  easternDay,
  previousTradingDay,
  tradingDayOnOrBefore,
  valuationDateFor,
} from "./market-calendar";

export type BalanceSource = "reported" | "snapshot";

/** A fund's close on a day: `close` as quoted, `adjClose` with splits and
 *  distributions in (what a holder's money actually did). */
export type DailyClose = { close: number; adjClose: number };

export type BalancePosition = {
  /** Shares in the feed's latest report. */
  shares: number;
  /** Shares at the close of each day a report shows, oldest first; a move
   *  from a day uses that day's shares (latest on or before it). */
  sharesByDay?: readonly { day: string; shares: number }[];
  /** The fund's own prices; null when it has none. */
  closes: ReadonlyMap<string, DailyClose> | null;
  /** Money market or cash: worth the same at every close. */
  cash?: boolean;
  /** The day its feed's balance already includes it through. */
  feedDay: string | null;
};

export type CurrentBalanceInput = {
  key: string;
  /** The feeds behind this figure (none for a part no feed covers). */
  feedIds?: readonly number[];
  performanceAccountId: number | null;
  label: string;
  /** The feeds' balance; null with no feed covering this money. */
  reported: number | null;
  /** The oldest day those feeds' data reflects; null when it can't be told. */
  reportedDay: string | null;
  snapshot: number;
  /** The day this entry's snapshot figure reflects, when it's known to be
   *  older than the snapshot's own (a figure taken from a feed). */
  snapshotDay?: string | null;
  /** Money with nothing to compare against: no part of the snapshot holds
   *  it. Counts in the total, never as a change. */
  noSnapshot?: boolean;
  positions: readonly BalancePosition[];
};

export type CurrentBalance = {
  key: string;
  feedIds: readonly number[];
  performanceAccountId: number | null;
  label: string;
  source: BalanceSource;
  noSnapshot: boolean;
  snapshot: number;
  /** What the feeds say, as reported; null with no feed. */
  reported: number | null;
  /** The figure it starts from, and that figure's day. */
  base: number;
  baseDay: string;
  /** Price moves since the base; 0 when none could be priced. */
  rolledForward: number;
  /** Day the rolled prices are from; null when not rolled. */
  rolledTo: string | null;
  /** Some holdings had no price to roll with. */
  partialRoll: boolean;
  current: number;
  /** Caught up to the snapshot: its change since then means something. */
  comparable: boolean;
};

const cents = (n: number) => Math.round(n * 100) / 100;

function sharesOn(p: BalancePosition, day: string): number {
  const known = p.sharesByDay ?? [];
  return (
    known.filter((k) => k.day <= day).at(-1)?.shares ??
    known[0]?.shares ??
    p.shares
  );
}

/**
 * What the held shares made from one close to a later one, at each fund's
 * own total-return prices (distributions in). The one price path: the
 * roll to the latest close and every daily move both come from it, so the
 * moves add up to the roll. Cash never moves. `partial`: some fund had no
 * price for one of the two closes.
 */
export function priceMove(
  positions: readonly BalancePosition[],
  fromOf: (p: BalancePosition) => string | null,
  to: string,
): { amount: number; moved: boolean; partial: boolean } {
  let amount = 0;
  let moved = false;
  let partial = false;
  for (const p of positions) {
    if (p.cash) continue;
    const from = fromOf(p);
    if (from !== null && from >= to) continue;
    const start = from ? p.closes?.get(from) : undefined;
    const end = p.closes?.get(to);
    if (!start || !end) {
      partial = true;
      continue;
    }
    amount +=
      sharesOn(p, from!) * start.close * (end.adjClose / start.adjClose - 1);
    moved = true;
  }
  return { amount: cents(amount), moved, partial };
}

/**
 * One entry's market move into the close `day` from the session before
 * it; null when it can't be told in full (no holdings reported, or a fund
 * with no price for either close) — a partial move would read as the
 * whole.
 */
export function moveIntoClose(
  positions: readonly BalancePosition[],
  day: string,
): number | null {
  if (positions.length === 0) return null;
  const from = previousTradingDay(day);
  const m = priceMove(positions, () => from, day);
  return m.partial ? null : m.amount;
}

export function currentBalance(
  a: CurrentBalanceInput,
  snapshotDay: string,
  /** The close every balance is brought to. */
  target: string,
): CurrentBalance {
  const entrySnapshotDay = a.snapshotDay ?? snapshotDay;
  const noSnapshot = a.noSnapshot === true;
  // Strictly newer: on the snapshot's own close the snapshot wins.
  const caughtUp =
    a.reported !== null &&
    (noSnapshot ||
      (a.reportedDay !== null && a.reportedDay > entrySnapshotDay));
  const base = caughtUp ? a.reported! : a.snapshot;
  const baseDay = caughtUp ? (a.reportedDay ?? "") : entrySnapshotDay;
  // Each feed's balance already holds its own days; a snapshot, its day.
  const rolled =
    baseDay < target
      ? priceMove(
          a.positions,
          (p) => (caughtUp ? p.feedDay : entrySnapshotDay),
          target,
        )
      : { amount: 0, moved: false, partial: false };
  return {
    key: a.key,
    feedIds: a.feedIds ?? [],
    performanceAccountId: a.performanceAccountId,
    label: a.label,
    source: caughtUp ? "reported" : "snapshot",
    noSnapshot,
    snapshot: a.snapshot,
    reported: a.reported,
    base,
    baseDay,
    rolledForward: rolled.amount,
    rolledTo: rolled.moved ? target : null,
    partialRoll: rolled.moved && rolled.partial,
    current: cents(base + rolled.amount),
    comparable: caughtUp && !noSnapshot,
  };
}

/** Each entry's figure less what the snapshot holds of it — money the
 *  snapshot never held isn't a change. */
export function changeSinceSnapshot(balances: readonly CurrentBalance[]) {
  return cents(
    balances
      .filter((b) => !b.noSnapshot)
      .reduce((t, b) => t + (b.current - b.snapshot), 0),
  );
}

/**
 * The market day a snapshot's figures reflect. Saved on its own date, the
 * save time decides (as for a feed's report: before the close, the prior
 * session). Backdated, only the date is known: that day's close. Never a
 * close later than the save.
 */
export function snapshotDataDay(snapshotDate: string, savedAt: Date): string {
  const dated = tradingDayOnOrBefore(snapshotDate);
  const saved = valuationDateFor(savedAt);
  if (easternDay(savedAt) === snapshotDate) return saved;
  return saved < dated ? saved : dated;
}

export function summarizeCurrentBalances(balances: readonly CurrentBalance[]): {
  total: number;
  reportedTotal: number;
  /** Balances taken from the snapshot though a feed covers them. */
  behindCount: number;
  estimatedCount: number;
  comparedCount: number;
  /** Latest close anything was rolled to; null when nothing was. */
  estimatedTo: string | null;
  /** Some balances didn't reach `estimatedTo`, or only partly did. */
  estimateIsPartial: boolean;
} {
  const rolled = balances.filter((b) => b.rolledTo !== null);
  const estimatedTo =
    rolled
      .map((b) => b.rolledTo!)
      .sort()
      .at(-1) ?? null;
  return {
    total: cents(balances.reduce((t, b) => t + b.current, 0)),
    reportedTotal: cents(balances.reduce((t, b) => t + (b.reported ?? 0), 0)),
    behindCount: balances.filter(
      (b) => b.source === "snapshot" && b.reported !== null,
    ).length,
    estimatedCount: rolled.length,
    comparedCount: balances.filter((b) => b.comparable).length,
    estimatedTo,
    estimateIsPartial: rolled.some(
      (b) => b.partialRoll || b.rolledTo !== estimatedTo,
    ),
  };
}

export type BalanceFeed = {
  id: number;
  performanceAccountId: number | null;
  subKey: string | null;
  balance: number;
  /** The day its data reflects; null when it can't be told. */
  dataDay: string | null;
};

type BalancePart = {
  key: string;
  performanceAccountId: number;
  label: string;
  amount: number;
};

/**
 * Pair feeds with the snapshot's parts. A feed linked to a part compares
 * with that part. A whole-account feed, or one whose part is gone (it
 * counts for the whole account until it's relinked), compares with the
 * whole account. A feed with no tracked account or no parts has nothing to
 * compare with: it counts, unchanged.
 */
export function pairFeedsWithParts(args: {
  feeds: readonly BalanceFeed[];
  parts: readonly BalancePart[];
  accountName: (performanceAccountId: number) => string;
  feedName: (feedId: number) => string;
  positionsOf: (feedIds: readonly number[]) => BalancePosition[];
}): CurrentBalanceInput[] {
  const { feeds, parts, accountName, feedName, positionsOf } = args;
  const total = (list: readonly BalanceFeed[]) =>
    list.reduce((t, f) => t + f.balance, 0);
  const oldest = (list: readonly BalanceFeed[]) =>
    list.some((f) => f.dataDay === null)
      ? null
      : (list.map((f) => f.dataDay!).sort()[0] ?? null);
  const ids = (list: readonly BalanceFeed[]) => list.map((f) => f.id);
  const out: CurrentBalanceInput[] = [];
  for (const f of feeds.filter((x) => x.performanceAccountId === null)) {
    out.push({
      key: `feed:${f.id}`,
      feedIds: [f.id],
      performanceAccountId: null,
      label: feedName(f.id),
      reported: f.balance,
      reportedDay: f.dataDay,
      snapshot: 0,
      noSnapshot: true,
      positions: positionsOf([f.id]),
    });
  }
  const accounts = new Set(
    feeds
      .map((f) => f.performanceAccountId)
      .filter((id): id is number => id !== null),
  );
  for (const id of accounts) {
    const mine = feeds.filter((f) => f.performanceAccountId === id);
    const myParts = parts.filter((p) => p.performanceAccountId === id);
    const keys = new Set(myParts.map((p) => p.key));
    const wholeAccount =
      myParts.length === 0 ||
      mine.some((f) => f.subKey === null || !keys.has(f.subKey));
    if (wholeAccount) {
      out.push({
        key: `account:${id}`,
        feedIds: ids(mine),
        performanceAccountId: id,
        label: accountName(id),
        reported: total(mine),
        reportedDay: oldest(mine),
        snapshot: myParts.reduce((t, p) => t + p.amount, 0),
        noSnapshot: myParts.length === 0,
        positions: positionsOf(ids(mine)),
      });
      continue;
    }
    for (const part of myParts) {
      const linked = mine.filter((f) => f.subKey === part.key);
      out.push({
        key: part.key,
        feedIds: ids(linked),
        performanceAccountId: id,
        label: `${accountName(id)} — ${part.label}`,
        reported: linked.length > 0 ? total(linked) : null,
        reportedDay: linked.length > 0 ? oldest(linked) : null,
        snapshot: part.amount,
        positions: positionsOf(ids(linked)),
      });
    }
  }
  return out;
}
