/** The Current Balances card's rows by group, and the accounts whose feeds
 *  send no holdings: their balance moved, but how much was the market
 *  and how much was money paid in can't be told. */
import { formatCurrency } from "@/lib/utils/format";
import { roundToCents } from "@/lib/utils/math";
import { balanceChangeInto, type BalanceAt } from "./current-balances";

/** A balance with no holdings whose balance changed into a close. */
export type NoHoldings = { institution: string; balance: number };

type GroupRow = {
  current: number;
  /** Holds funds that move with markets. */
  market: boolean;
  move: number | null;
  noHoldings?: NoHoldings | null;
};

export type CurrentGroup = {
  key: string;
  label: string;
  /** Adds up to the card's total. */
  current: number;
  /** Move into the card's close; null when any fund in it can't be told
   *  (a partial sum would read as the whole). */
  move: number | null;
  /** Its accounts with no holdings whose balance changed: their
   *  institutions and that change (market and deposits together). */
  noHoldings: { institutions: string[]; balance: number } | null;
};

/** The card's figures by row: largest first, "Not matched" last. */
export function groupCurrentBalances<B extends GroupRow>(
  balances: readonly B[],
  bucket: (b: B) => { key: string; label: string },
): CurrentGroup[] {
  const groups = new Map<string, CurrentGroup & { unknown: boolean }>();
  for (const b of balances) {
    const { key, label } = bucket(b);
    const g = groups.get(key) ?? {
      key,
      label,
      current: 0,
      move: 0,
      noHoldings: null,
      unknown: false,
    };
    g.current = roundToCents(g.current + b.current);
    if (b.noHoldings) {
      g.unknown = true;
      const had = g.noHoldings ?? { institutions: [], balance: 0 };
      g.noHoldings = {
        institutions: [
          ...new Set([...had.institutions, b.noHoldings.institution]),
        ],
        balance: roundToCents(had.balance + b.noHoldings.balance),
      };
    } else if (b.market && b.move !== null)
      g.move = roundToCents((g.move ?? 0) + b.move);
    else if (b.market) g.unknown = true;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ unknown, ...g }) => ({ ...g, move: unknown ? null : g.move }))
    .sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : b.current - a.current,
    );
}

/** An account whose feeds send no holdings, by the closes its balance
 *  changed into (market and deposits together). */
export type UnpricedMove = {
  key: string;
  performanceAccountId: number;
  label: string;
  /** The whole account's name. */
  account: string;
  institution: string;
  changed: { day: string; balance: number }[];
};

/** Accounts linked to a tracked account with no holdings (not among
 *  `marketKeys`), by the closes their feeds' balance changed into. One
 *  that didn't change, or can't be told, isn't listed: cash stays at zero. */
export function unpricedMoves(args: {
  balances: readonly {
    key: string;
    label: string;
    account: string;
    feedIds: readonly number[];
    performanceAccountId: number | null;
  }[];
  marketKeys: ReadonlySet<string>;
  institutionOf: (feedId: number) => string;
  /** The closes shown, latest first. */
  sessions: readonly string[];
  balanceAt: BalanceAt;
}): UnpricedMove[] {
  return args.balances.flatMap((b) => {
    if (
      b.performanceAccountId === null ||
      b.feedIds.length === 0 ||
      args.marketKeys.has(b.key)
    )
      return [];
    const changed = args.sessions.flatMap((day) => {
      const change = balanceChangeInto(b.feedIds, day, args.balanceAt);
      if (change === null) return [];
      const cents = roundToCents(change);
      return Math.abs(cents) < 0.005 ? [] : [{ day, balance: cents }];
    });
    if (changed.length === 0) return [];
    const institution = args.institutionOf(b.feedIds[0]!);
    return [
      {
        key: b.key,
        performanceAccountId: b.performanceAccountId,
        label: b.label,
        account: b.account,
        institution,
        changed,
      },
    ];
  });
}

/** Each listed account's change into `day`, by key. */
export function noHoldingsInto(
  unpriced: readonly UnpricedMove[],
  day: string,
): Map<string, NoHoldings> {
  return new Map(
    unpriced.flatMap((u) => {
      const m = u.changed.find((c) => c.day === day);
      return m
        ? [[u.key, { institution: u.institution, balance: m.balance }]]
        : [];
    }),
  );
}

/** Hover on a row whose move can't be shown: "Balance −$151.08; Voya
 *  sends no holdings, so market and deposits can't be split". */
export function noHoldingsTitle(n: {
  institutions: readonly string[];
  balance: number;
}): string {
  const names = [...new Set(n.institutions.map((x) => x.split(/\s+/)[0] || x))];
  const who =
    names.length <= 1
      ? `${names[0] || "The institution"} sends`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} send`;
  return `Balance ${n.balance >= 0 ? "+" : "−"}${formatCurrency(Math.abs(n.balance))}; ${who} no holdings, so market and deposits can't be split`;
}
