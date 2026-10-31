/**
 * Daily movement, dated by market close — not by when Ledgr synced. Each
 * feed's balance reports are put on the close they reflect, and its move
 * is its latest close against the close before it. Feeds that aren't on
 * the same close are kept apart by close, never added up as one day.
 * Money moved in or out (from the feed's transactions) is split from the
 * market's move where the feed sends transactions.
 */

export type DatedReport = { day: string; balance: number };

export type FeedMovement = {
  feedId: number;
  /** The close this move ends at. */
  day: string;
  /** The close before it that the move starts from. */
  fromDay: string;
  move: number;
  /** Deposits less withdrawals posted after `fromDay` through `day`; null
   *  when the feed sends no transactions. */
  flows: number | null;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** The last report on each close, oldest first. */
export function balancesByClose(
  reports: readonly DatedReport[],
): DatedReport[] {
  const byDay = new Map<string, number>();
  for (const r of reports) byDay.set(r.day, r.balance);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, balance]) => ({ day, balance }));
}

/**
 * A feed's move into its latest close: `latestDay` is the close its
 * current balance reflects (the best dating there is for it). Null with
 * nothing earlier to compare.
 */
export function feedMovement(args: {
  feedId: number;
  reports: readonly DatedReport[];
  latestDay: string;
  latestBalance: number;
  /** Signed money in / out: day posted and amount; null = not sent. */
  flows: readonly { day: string; amount: number }[] | null;
}): FeedMovement | null {
  const prior = balancesByClose(args.reports)
    .filter((r) => r.day < args.latestDay)
    .at(-1);
  if (!prior) return null;
  return {
    feedId: args.feedId,
    day: args.latestDay,
    fromDay: prior.day,
    move: cents(args.latestBalance - prior.balance),
    flows:
      args.flows === null
        ? null
        : cents(
            args.flows
              .filter((f) => f.day > prior.day && f.day <= args.latestDay)
              .reduce((t, f) => t + f.amount, 0),
          ),
  };
}

export type CloseMovement = {
  day: string;
  move: number;
  /** Money in less money out, where every feed on this close sends
   *  transactions; null when some don't. */
  flows: number | null;
  feedIds: number[];
};

/** Moves grouped by the close they end at, latest close first. */
export function movementByClose(
  moves: readonly FeedMovement[],
): CloseMovement[] {
  const byDay = new Map<string, FeedMovement[]>();
  for (const m of moves) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({
      day,
      move: cents(list.reduce((t, m) => t + m.move, 0)),
      flows: list.some((m) => m.flows === null)
        ? null
        : cents(list.reduce((t, m) => t + m.flows!, 0)),
      feedIds: list.map((m) => m.feedId),
    }));
}
