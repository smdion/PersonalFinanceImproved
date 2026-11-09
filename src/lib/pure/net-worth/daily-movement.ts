/**
 * Daily movement dated by market close, never by sync: each account's move comes
 * from its funds' own prices (`moveIntoClose`), so money in or out can't read as
 * the market's. That money shows beside the move, by the close it landed before.
 */
import { previousTradingDay } from "../investments/market-calendar";
import { priceMove, type BalancePosition } from "../accounts/current-balances";

export type EntryMoves = {
  key: string;
  /** Its institution: named when its move is missing. */
  name: string;
  /** The feeds behind it, to match its reported transactions. */
  feedIds?: readonly number[];
  /** Per close: the market move, or null when it can't be told in full;
   *  and the money its share counts show going in or out (null unknown). */
  moves: readonly { day: string; move: number | null; added?: number | null }[];
};

/** Below this, share counts and reported transactions agree: rounding,
 *  fractional shares, a cent of interest. */
export const UNREPORTED_MIN = 25;

export type CloseMovement = {
  day: string;
  /** Sum of the accounts whose move is known. */
  move: number;
  known: number;
  total: number;
  /** Institutions whose move into this close is missing, in order. */
  missing: string[];
  /** Money in less money out that landed after the close before through
   *  this one; null when some market account sends no transactions. */
  flows: number | null;
  /** Money the share counts show going in or out that no transaction has
   *  been reported for yet (institutions send transactions days late), and
   *  whose accounts. Null when there's none. */
  unreported: { amount: number; names: string[] } | null;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Latest close first. */
export function dailyMovement(args: {
  /** Closes to show, latest first. */
  sessions: readonly string[];
  entries: readonly EntryMoves[];
  /** Signed money in / out by the day it posted. */
  flows: readonly { day: string; amount: number }[];
  flowsKnown: boolean;
  /** Every reported transaction that changes share counts (money in and
   *  out, dividends, interest, fees), by feed. */
  shareChanges?: readonly { feedId: number; day: string; amount: number }[];
}): CloseMovement[] {
  return args.sessions.map((day) => {
    const from = previousTradingDay(day);
    const moves = args.entries.map(
      (e) => e.moves.find((m) => m.day === day)?.move ?? null,
    );
    const missing = [
      ...new Set(
        args.entries.filter((_, i) => moves[i] === null).map((e) => e.name),
      ),
    ];
    const known = moves.filter((m): m is number => m !== null);
    // Share counts against reported transactions, entry by entry.
    let gap = 0;
    const names = new Set<string>();
    for (const e of args.entries) {
      const added = e.moves.find((m) => m.day === day)?.added;
      if (added === null || added === undefined || !e.feedIds?.length) continue;
      const reported = (args.shareChanges ?? [])
        .filter(
          (f) => e.feedIds!.includes(f.feedId) && f.day > from && f.day <= day,
        )
        .reduce((t, f) => t + f.amount, 0);
      const missing = added - reported;
      if (Math.abs(missing) < UNREPORTED_MIN) continue;
      gap += missing;
      names.add(e.name);
    }
    return {
      day,
      move: cents(known.reduce((t, m) => t + m, 0)),
      known: known.length,
      total: moves.length,
      missing,
      flows: args.flowsKnown
        ? cents(
            args.flows
              .filter((f) => f.day > from && f.day <= day)
              .reduce((t, f) => t + f.amount, 0),
          )
        : null,
      unreported:
        Math.abs(gap) >= UNREPORTED_MIN
          ? { amount: cents(gap), names: [...names] }
          : null,
    };
  });
}

/** One market account's closes over the card's window: which hold a value
 *  (every fund priced), and its market move over each run without one. */
export type CloseReport = {
  key: string;
  /** Its institution, as in `CloseMovement.missing`. */
  name: string;
  /** Oldest first, from the close before the earliest shown. */
  closes: readonly { day: string; valued: boolean }[];
  /** Each run of closes with no value, between two closes with one. */
  gaps: readonly {
    before: string;
    after: string;
    missing: readonly string[];
    /** The market move from `before` to `after`, at its funds' own prices. */
    move: number;
  }[];
};

const valuedOn = (positions: readonly BalancePosition[], day: string) =>
  positions.length > 0 &&
  positions.every((p) => p.cash || p.closes?.get(day) !== undefined);

/** The accounts missing a value at some close of the window, with where.
 *  An account with no value at any close is left out: why can't be told
 *  (nothing priced, or no prices at all). */
export function closeReports(
  entries: readonly {
    key: string;
    name: string;
    positions: readonly BalancePosition[];
  }[],
  /** The closes shown, latest first. */
  sessions: readonly string[],
): CloseReport[] {
  if (sessions.length === 0) return [];
  const days = [
    previousTradingDay(sessions.at(-1)!),
    ...[...sessions].reverse(),
  ];
  return entries.flatMap((e) => {
    const closes = days.map((day) => ({
      day,
      valued: valuedOn(e.positions, day),
    }));
    if (closes.every((c) => c.valued) || closes.every((c) => !c.valued))
      return [];
    const gaps: CloseReport["gaps"][number][] = [];
    let run: string[] = [];
    closes.forEach((c, i) => {
      if (!c.valued) return void run.push(c.day);
      const before = closes[i - run.length - 1];
      if (run.length > 0 && before)
        gaps.push({
          before: before.day,
          after: c.day,
          missing: run,
          move: priceMove(e.positions, () => before.day, c.day).amount,
        });
      run = [];
    });
    return [{ key: e.key, name: e.name, closes, gaps }];
  });
}
