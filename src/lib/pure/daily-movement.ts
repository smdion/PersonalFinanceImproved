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
  /** Per close: the market move, or null when it can't be told in full. */
  moves: readonly { day: string; move: number | null }[];
};

export type CloseMovement = {
  day: string;
  /** Sum of the accounts whose move is known. */
  move: number;
  known: number;
  total: number;
  /** Money in less money out that landed after the close before through
   *  this one; null when some market account sends no transactions. */
  flows: number | null;
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
}): CloseMovement[] {
  return args.sessions.map((day) => {
    const from = previousTradingDay(day);
    const moves = args.entries.map(
      (e) => e.moves.find((m) => m.day === day)?.move ?? null,
    );
    const known = moves.filter((m): m is number => m !== null);
    return {
      day,
      move: cents(known.reduce((t, m) => t + m, 0)),
      known: known.length,
      total: moves.length,
      flows: args.flowsKnown
        ? cents(
            args.flows
              .filter((f) => f.day > from && f.day <= day)
              .reduce((t, f) => t + f.amount, 0),
          )
        : null,
    };
  });
}
