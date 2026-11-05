/**
 * Realized vs assumed returns: each completed year's actual return (the
 * Performance page's Portfolio return) next to the rate the projections
 * assume for that year. Pure; display only.
 *
 * The assumed rate is looked up the way the projection engine does: the
 * return-rate table's row for the highest age at or below the primary
 * person's age. Years compound into one annual figure per side (chain-
 * linked), so a few big years don't dominate a simple average.
 */
import { chainReturns } from "./returns";
import { returnRateAtAge } from "../simulation/return-rate-breakpoints";

type ReturnRateRow = { age: number; rate: number };

/** The table's rate for `age`: highest age at or below it, else the lowest. */
export function assumedRateAt(
  rates: readonly ReturnRateRow[],
  age: number,
): number | null {
  if (rates.length === 0) return null;
  const pairs = rates.map((r) => [r.age, r.rate] as const);
  // Before the first breakpoint, the first one's rate.
  return (
    returnRateAtAge(pairs, age) ??
    [...rates].sort((a, b) => a.age - b.age)[0]!.rate
  );
}

type RealizedVsAssumedYear = {
  year: number;
  /** The primary person's age that year. */
  age: number;
  realized: number;
  assumed: number;
};

export function realizedVsAssumed(
  years: readonly { year: number; returnPct: number | null }[],
  primaryBirthYear: number | null,
  rates: readonly ReturnRateRow[],
  currentYear: number,
): {
  rows: RealizedVsAssumedYear[];
  realizedAnnual: number | null;
  assumedAnnual: number | null;
} {
  const rows: RealizedVsAssumedYear[] = [];
  if (primaryBirthYear !== null && rates.length > 0) {
    // Completed years with a real return; leading placeholder years (a
    // flat 0% entered for early years) don't start the comparison.
    const real = [...years]
      .filter((y) => y.year < currentYear && y.returnPct !== null)
      .sort((a, b) => a.year - b.year);
    const start = real.findIndex((y) => Math.abs(y.returnPct!) >= 0.001);
    for (const y of start < 0 ? [] : real.slice(start)) {
      const age = y.year - primaryBirthYear;
      const assumed = assumedRateAt(rates, age);
      if (assumed === null) continue;
      rows.push({ year: y.year, age, realized: y.returnPct!, assumed });
    }
  }
  return {
    rows,
    realizedAnnual: chainReturns(rows.map((r) => r.realized)).annualizedReturn,
    assumedAnnual: chainReturns(rows.map((r) => r.assumed)).annualizedReturn,
  };
}
