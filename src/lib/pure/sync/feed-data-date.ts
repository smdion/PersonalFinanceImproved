/**
 * The market day behind a feed's balance, which can predate the report (some institutions publish
 * the prior close late). Most certain first: proven by position prices, learned from the
 * institution's balance history, else `valuationDateFor`. No positions: the report's own day.
 */
import { addDays } from "@/lib/utils/date";
import {
  reportCalendarDay,
  tradingDayOnOrBefore,
  valuationDateFor,
} from "../investments/market-calendar";

/** Lags that balance patterns can tell apart. */
const MAX_LAG = 1;
/** Sessions tried behind the latest a report could show. */
const PROOF_SESSIONS = 4;
/** What rounding can leave between value and shares × close: a cent on the
 *  value, half a cent on the price. */
const VALUE_ROUNDING = 0.02;
const PRICE_ROUNDING = 0.005;
/** Different market gaps a pattern must show at before it's believed. */
const MIN_GAPS_WITH_EVIDENCE = 2;
/** Share of a lag's same-session changes tolerated: a deposit can land on a
 *  weekend without any new close. */
const MAX_CONFLICT_SHARE = 0.25;

export type DataDateBasis = "proven" | "learned" | "assumed";

/**
 * The session a report shows at a lag of `k`: 0 is the last close on or
 * before the report's calendar day, 1 the last close before that day (a
 * Thursday-night report shows Wednesday's; a Saturday-night one, Friday's).
 */
export function laggedSession(reportedAt: Date, k: number): string {
  const day = reportCalendarDay(reportedAt);
  return tradingDayOnOrBefore(k > 0 ? addDays(day, -1) : day);
}

/**
 * The report lag (0 or 1) fitting one institution's market feeds (reports ascending): a balance
 * change between two reports a lag puts on one session rules it out; the other is believed once
 * ruled out at several gaps. Null while no balance has moved.
 */
export function learnReportLag(
  feeds: readonly (readonly { reportedAt: Date; balance: number }[])[],
): { lag: number; confident: boolean } | null {
  const conflicts = [new Set<string>(), new Set<string>()];
  const counts = [0, 0];
  let changes = 0;
  for (const reports of feeds) {
    for (let i = 1; i < reports.length; i++) {
      const before = reports[i - 1]!;
      const after = reports[i]!;
      if (after.balance === before.balance) continue;
      changes++;
      for (let k = 0; k <= MAX_LAG; k++) {
        const session = laggedSession(after.reportedAt, k);
        if (session !== laggedSession(before.reportedAt, k)) continue;
        conflicts[k]!.add(session);
        counts[k]!++;
      }
    }
  }
  if (changes === 0) return null;
  const lag = counts[1]! < counts[0]! ? 1 : 0;
  return {
    lag,
    confident:
      conflicts[1 - lag]!.size >= MIN_GAPS_WITH_EVIDENCE &&
      counts[lag]! / changes <= MAX_CONFLICT_SHARE,
  };
}

/**
 * The market day whose closes match a feed's positions, or null when no single day fits. Only the
 * latest possible day and a few sessions before it are tried, and that day's close must be known.
 */
export function provenDataDay(
  positions: readonly {
    ticker: string | null;
    shares: number;
    reportedMarketValue: number | null;
  }[],
  closes: ReadonlyMap<string, ReadonlyMap<string, { close: number }>>,
  latestPossibleDay: string,
): string | null {
  const priced = positions.flatMap((p) => {
    const series = p.ticker ? closes.get(p.ticker) : undefined;
    return series && p.reportedMarketValue !== null && p.shares > 0
      ? [{ value: p.reportedMarketValue, shares: p.shares, series }]
      : [];
  });
  if (priced.length === 0) return null;
  if (priced.some((p) => !p.series.has(latestPossibleDay))) return null;
  const days = [...priced[0]!.series.keys()]
    .filter((d) => d <= latestPossibleDay)
    .sort()
    .slice(-PROOF_SESSIONS);
  const fits = days.filter((day) =>
    priced.every(({ value, shares, series }) => {
      const close = series.get(day)?.close;
      return (
        close !== undefined &&
        Math.abs(value - shares * close) <=
          VALUE_ROUNDING + shares * PRICE_ROUNDING
      );
    }),
  );
  return fits.length === 1 ? fits[0]! : null;
}

/** A market feed's data day, from what's known, most certain first. */
export function feedDataDay(args: {
  reportedAt: Date;
  proven: string | null;
  learned: { lag: number; confident: boolean } | null;
}): { day: string; basis: DataDateBasis } {
  const assumed = valuationDateFor(args.reportedAt);
  if (args.proven) return { day: args.proven, basis: "proven" };
  if (args.learned?.confident)
    return {
      day: laggedSession(args.reportedAt, args.learned.lag),
      basis: "learned",
    };
  return { day: assumed, basis: "assumed" };
}
