/**
 * The Simulation's dollar outcomes in the dollars a view shows. Today's
 * dollars come from the Simulation itself — each trial deflated by the
 * inflation it ran with, before the percentiles — so a view never deflates
 * a simulated figure at the plan's fixed rate (that would erase the
 * inflation each trial drew). Nominal is the engine's own output.
 */
import type {
  DistributionSummary,
  MonteCarloPercentileBand,
  MonteCarloResult,
} from "@/lib/calculators/types";
import type { DollarBasis } from "@/lib/config/enum-values";

export function simulationDollars(
  result: Pick<
    MonteCarloResult,
    "percentileBands" | "distributions" | "medianEndBalance" | "worstCase"
  > & { today: MonteCarloResult["today"] },
  mode: DollarBasis,
): {
  percentileBands: MonteCarloPercentileBand[];
  terminalBalance: DistributionSummary;
  medianEndBalance: number;
  p5EndBalance: number;
} {
  return mode === "real"
    ? result.today
    : {
        percentileBands: result.percentileBands,
        terminalBalance: result.distributions.terminalBalance,
        medianEndBalance: result.medianEndBalance,
        p5EndBalance: result.worstCase.p5EndBalance,
      };
}

/** A year's price index against `baseYear`: 1 at or before it. */
export type Deflator = {
  readonly baseYear: number;
  readonly indexOf: (year: number) => number;
};

/** One flat annual rate compounded from `baseYear` (a view's own rate). */
export function flatDeflator(
  baseYear: number,
  annualInflation: number,
): Deflator {
  return {
    baseYear,
    indexOf: (year) =>
      year > baseYear ? Math.pow(1 + annualInflation, year - baseYear) : 1,
  };
}

/** A `year` figure in the deflator's base-year dollars. */
export function toTodaysDollars(
  value: number,
  year: number,
  deflator: Deflator,
): number {
  return value / deflator.indexOf(year);
}
