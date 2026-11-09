/**
 * The return-rate table as breakpoints: a row's rate applies from its age to the next row.
 * `returnRateAtAge` is its one reading. The router drops rows repeating the previous rate.
 */

/** What the projection cards say when no breakpoint is at or below the
 *  household's current age (`notConfigured: "no_return_rate"`): none ship;
 *  the household sets them. */
export const NO_RETURN_RATE_MESSAGE =
  "Set a return rate first: projections need an expected return from your current age on.";

/** The rate in effect at `age`: the breakpoint with the highest age at or
 *  below it, or null below the first breakpoint (each caller decides what
 *  that means). Takes `[age, rate]` pairs in any order — a Map works as is. */
export function returnRateAtAge(
  breakpoints: Iterable<readonly [number, number]>,
  age: number,
): number | null {
  let bestAge = -Infinity;
  let rate: number | null = null;
  for (const [a, r] of breakpoints)
    if (a <= age && a > bestAge) {
      bestAge = a;
      rate = r;
    }
  return rate;
}

/** Ids of rows whose rate equals the previous breakpoint's (rates compared
 *  at the column's precision, decimal(8,6)). */
export function redundantReturnRateIds(
  rows: { id: number; age: number; rateOfReturn: string | number }[],
): number[] {
  const sorted = [...rows].sort((a, b) => a.age - b.age);
  return sorted
    .filter(
      (r, i) =>
        i > 0 &&
        Math.abs(Number(r.rateOfReturn) - Number(sorted[i - 1]!.rateOfReturn)) <
          5e-7,
    )
    .map((r) => r.id);
}
