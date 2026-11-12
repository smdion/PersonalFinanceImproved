/**
 * The run's inflation per year, resolved once so every compounding site agrees. A plain run uses
 * the closed form; a Simulation trial adds a per-year shock to both rates. `growth(k)` is index k
 * vs 0; past the shocks the plan's rate applies. No clamp beyond the growth floor constant.
 */
import { SIMULATION_INFLATION_GROWTH_FLOOR } from "../../constants";
import { taxGrowthFactor } from "./bracket-growth";
import type { ProjectionInput } from "./types/projection-result";

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
    Math.max(SIMULATION_INFLATION_GROWTH_FLOOR, 1 + plan + shock) - 1;
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

/** A run's path: index 0 is the input's as-of year, with its shocks, at the
 *  rates given (the engine passes its validated ones; a Simulation trial
 *  its base rates). Every run's path is built here, so they agree. */
export function runInflationPath(
  input: Pick<ProjectionInput, "asOfDate" | "inflationShocks">,
  rates: { inflationRate: number; postRetirementInflationRate: number },
): InflationPath {
  return buildInflationPath({
    inflationRate: rates.inflationRate,
    postRetirementInflationRate: rates.postRetirementInflationRate,
    baseYear: input.asOfDate.getFullYear(),
    shocks: input.inflationShocks,
  });
}
