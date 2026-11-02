/**
 * Daily movement, dated by market close — never by when Ledgr synced. Each
 * account's move into a close comes from its funds' own prices
 * (`moveIntoClose` in current-balances.ts, the same path as the roll to
 * the latest close), so a feed that syncs a day late can't put a move on
 * the wrong day, and money paid in or out can't read as the market's.
 * That money is shown beside the move, by the close it landed before.
 */
import { previousTradingDay } from "./market-calendar";

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
