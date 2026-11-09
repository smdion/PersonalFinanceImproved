/**
 * The inflation a run sees, year by year — resolved once and read by every
 * site that compounds it, so expenses, Social Security, tax tables and the
 * Simulation's today's-dollars deflator can't disagree.
 *
 * A plain run has one rate per phase and each answer is its closed form
 * (`Math.pow`), byte for byte. A Simulation trial adds a shock per year; one
 * shock moves both rates, keeping the household's gap between them. Year
 * indexes count from the input's year: `growth(k)` is the price level at
 * index k against index 0, so `shocks[0]` is never compounded. Past the
 * shocks (a look ahead beyond the horizon) the plan's rate applies.
 *
 * No clamp beyond SIMULATION_INFLATION_GROWTH_FLOOR: truncating draws would bias
 * inflation up.
 */
import { MC_INFLATION_GROWTH_FLOOR } from "../../constants";
import { taxGrowthFactor } from "./bracket-growth";

export type InflationPath = {
  /** General inflation this year. */
  rate(yearIndex: number): number;
  /** Post-retirement raise this year. */
  postRate(yearIndex: number): number;
  /** Price level at this index against index 0. */
  growth(yearIndex: number): number;
  /** Price level at `to` against `from` (from <= to). */
  growthBetween(from: number, to: number): number;
  /** `growthBetween`, or null with no shocks: a caller with its own closed
   *  form keeps it, so a plain run stays byte-identical. */
  shockedGrowthBetween(from: number, to: number): number | null;
  /** A table dated `vintage` grown to `year` (1 before it). `forecastYears`
   *  looks that far past `year`, at the plan's rate: a future year's
   *  inflation isn't known yet. */
  growthSinceVintage(
    year: number,
    vintage: number | undefined,
    forecastYears?: number,
  ): number;
};

export function buildInflationPath(args: {
  inflationRate: number;
  postRetirementInflationRate: number;
  /** Year of index 0. */
  baseYear: number;
  shocks?: readonly number[];
}): InflationPath {
  const { inflationRate, postRetirementInflationRate, baseYear, shocks } = args;
  if (!shocks || shocks.length === 0) {
    return {
      rate: () => inflationRate,
      postRate: () => postRetirementInflationRate,
      growth: (i) => Math.pow(1 + inflationRate, Math.max(0, i)),
      growthBetween: (from, to) =>
        Math.pow(1 + inflationRate, Math.max(0, to - from)),
      shockedGrowthBetween: () => null,
      growthSinceVintage: (year, vintage, forecastYears = 0) =>
        taxGrowthFactor(year + forecastYears, vintage, inflationRate),
    };
  }

  const shocked = (plan: number, shock: number) =>
    Math.max(MC_INFLATION_GROWTH_FLOOR, 1 + plan + shock) - 1;
  const rate = (i: number) =>
    i < shocks.length ? shocked(inflationRate, shocks[i]!) : inflationRate;
  // One array per trial, O(1) lookups.
  const levels = [1];
  for (let i = 1; i < shocks.length; i++)
    levels.push(levels[i - 1]! * (1 + rate(i)));
  const last = levels.length - 1;
  const growth = (i: number) =>
    i <= 0
      ? 1
      : i <= last
        ? levels[i]!
        : levels[last]! * Math.pow(1 + inflationRate, i - last);
  const growthBetween = (from: number, to: number) => growth(to) / growth(from);
  const sinceVintage = (year: number, vintage: number) => {
    if (year <= vintage) return 1;
    const i = year - baseYear;
    return vintage >= baseYear
      ? growthBetween(vintage - baseYear, i)
      : Math.pow(1 + inflationRate, baseYear - vintage) * growth(i);
  };
  return {
    rate,
    postRate: (i) =>
      i < shocks.length
        ? shocked(postRetirementInflationRate, shocks[i]!)
        : postRetirementInflationRate,
    growth,
    growthBetween,
    shockedGrowthBetween: growthBetween,
    growthSinceVintage: (year, vintage, forecastYears = 0) => {
      if (vintage == null) return 1;
      const known = sinceVintage(year, vintage);
      const ahead = Math.min(
        forecastYears,
        Math.max(0, year + forecastYears - vintage),
      );
      return known * Math.pow(1 + inflationRate, ahead);
    },
  };
}
