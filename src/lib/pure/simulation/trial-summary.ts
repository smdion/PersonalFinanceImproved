/** What the Simulation's trials add up to: percentiles, bands and rates. */
import { planRetirementAge } from "@/lib/pure/household/household-timeline";
import type { PlanFailureReason } from "../retirement/plan-outcome";
import { blendedReturnStats } from "./random";
import type {
  MonteCarloInput,
  MonteCarloPercentileBand,
  DistributionSummary,
} from "./monte-carlo.types";
import type { ProjectionInput } from "../engine/types";
import { sumBy, safeDivide } from "../../utils/math";
import { MC_SPENDING_STABILITY_THRESHOLD } from "../../constants";

/** Extract the percentile value from a sorted array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (index - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Compute summary statistics for a distribution. */
export function computeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      min: 0,
      p5: 0,
      p10: 0,
      p25: 0,
      median: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sumBy(values, (v) => v) / values.length;
  const variance = sumBy(values, (v) => (v - mean) ** 2) / values.length;

  return {
    min: sorted[0]!,
    p5: percentile(sorted, 5),
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
    mean,
    stdDev: Math.sqrt(variance),
  };
}

export function balanceBands(
  gkAnchorRates: number[],
  assetClasses: MonteCarloInput["assetClasses"],
  correlationMatrix: number[][],
  glidePath: MonteCarloInput["glidePath"],
  startAge: number,
  priceLevelsByYear: number[][],
  inflationRisk: MonteCarloInput["inflationRisk"],
  yearsToRetirement: number,
  numYears: number,
  balancesByYear: number[][],
  engineInput: ProjectionInput,
  balancesTodayByYear: number[][],
) {
  const sortedAnchors = [...gkAnchorRates].sort((a, b) => a - b);
  const gkAnchorRange =
    sortedAnchors.length > 0
      ? {
          p25: percentile(sortedAnchors, 25),
          p75: percentile(sortedAnchors, 75),
        }
      : null;

  const assumptionsFor = (yearIndex: number) => {
    const stats = blendedReturnStats(
      assetClasses,
      correlationMatrix,
      glidePath,
      startAge + yearIndex,
    );
    if (!stats) return {};
    const levels = [...(priceLevelsByYear[yearIndex] ?? [])].sort(
      (a, b) => a - b,
    );
    const inflation =
      inflationRisk && inflationRisk.stdDev > 0 && levels.length > 0
        ? {
            stdDev: inflationRisk.stdDev,
            priceLevel: {
              p25: percentile(levels, 25),
              p50: percentile(levels, 50),
              p75: percentile(levels, 75),
            },
          }
        : undefined;
    const retired = yearIndex >= yearsToRetirement;
    return {
      assumptions: {
        ...stats,
        ...(inflation ? { inflation } : {}),
        ...(gkAnchorRange && retired ? { gkAnchorRange } : {}),
      },
    };
  };

  // Aggregate into percentile bands
  const percentileBands: MonteCarloPercentileBand[] = [];
  for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
    const balances = balancesByYear[yearIndex]!;
    if (balances.length === 0) continue;
    const sorted = [...balances].sort((a, b) => a - b);
    const mean = sumBy(balances, (v) => v) / balances.length;

    percentileBands.push({
      year: engineInput.asOfDate.getFullYear() + yearIndex,
      age: startAge + yearIndex,
      p5: percentile(sorted, 5),
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      mean,
      ...assumptionsFor(yearIndex),
    });
  }

  // The same bands in today's dollars — each trial deflated before sorting.
  const percentileBandsToday: MonteCarloPercentileBand[] = [];
  for (let yearIndex = 0; yearIndex < numYears; yearIndex++) {
    const balances = balancesTodayByYear[yearIndex]!;
    if (balances.length === 0) continue;
    const sorted = [...balances].sort((a, b) => a - b);
    percentileBandsToday.push({
      year: engineInput.asOfDate.getFullYear() + yearIndex,
      age: startAge + yearIndex,
      p5: percentile(sorted, 5),
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      mean: sumBy(balances, (v) => v) / balances.length,
      ...assumptionsFor(yearIndex),
    });
  }

  return { percentileBands, percentileBandsToday };
}

export function stabilityBands(
  engineInput: ProjectionInput,
  numDecYears: number,
  stratRatiosByDecYear: number[][],
  budgetRatiosByDecYear: number[][],
) {
  // Spending stability ratio bands (per decumulation year)
  const retirementStartAge = planRetirementAge(engineInput);
  const retirementStartYear = engineInput.retirementYear;

  const stratRatioBands: MonteCarloPercentileBand[] = [];
  const budgetRatioBands: MonteCarloPercentileBand[] = [];
  for (let di = 0; di < numDecYears; di++) {
    const stratRatios = stratRatiosByDecYear[di]!;
    if (stratRatios.length === 0) continue;
    const sortedStrat = [...stratRatios].sort((a, b) => a - b);
    const stratMean = sumBy(stratRatios, (v) => v) / stratRatios.length;
    const stratBreachRate = safeDivide(
      stratRatios.filter((r) => r < MC_SPENDING_STABILITY_THRESHOLD).length,
      stratRatios.length,
      0,
    );
    stratRatioBands.push({
      year: retirementStartYear + di,
      age: retirementStartAge + di,
      p5: percentile(sortedStrat, 5),
      p10: percentile(sortedStrat, 10),
      p25: percentile(sortedStrat, 25),
      p50: percentile(sortedStrat, 50),
      p75: percentile(sortedStrat, 75),
      p90: percentile(sortedStrat, 90),
      p95: percentile(sortedStrat, 95),
      mean: stratMean,
      breachRate: stratBreachRate,
    });

    const budgetRatios = budgetRatiosByDecYear[di]!;
    if (budgetRatios.length > 0) {
      const sortedBudget = [...budgetRatios].sort((a, b) => a - b);
      const budgetMean = sumBy(budgetRatios, (v) => v) / budgetRatios.length;
      const budgetBreachRate = safeDivide(
        budgetRatios.filter((r) => r < MC_SPENDING_STABILITY_THRESHOLD).length,
        budgetRatios.length,
        0,
      );
      budgetRatioBands.push({
        year: retirementStartYear + di,
        age: retirementStartAge + di,
        p5: percentile(sortedBudget, 5),
        p10: percentile(sortedBudget, 10),
        p25: percentile(sortedBudget, 25),
        p50: percentile(sortedBudget, 50),
        p75: percentile(sortedBudget, 75),
        p90: percentile(sortedBudget, 90),
        p95: percentile(sortedBudget, 95),
        mean: budgetMean,
        breachRate: budgetBreachRate,
      });
    }
  }

  const spendingStabilityBands =
    stratRatioBands.length > 0
      ? {
          stratRatio: stratRatioBands,
          budgetRatio: budgetRatioBands.length > 0 ? budgetRatioBands : null,
        }
      : null;

  return { spendingStabilityBands };
}

export function trialOutcomes(
  hadPenaltyAvoidedShortfall: boolean[],
  penaltyAvoidedShortfallAmountsPV: number[],
  spendingStableCount: number,
  numTrials: number,
  budgetStableCount: number,
  terminalBalances: number[],
  failureAges: number[],
  terminalBalancesToday: number[],
  failureReasonCounts: Record<PlanFailureReason, number>,
) {
  // "How much," not just "how often" -- median total shortfall (today's
  // dollars) among ONLY the trials that actually hit one. Answers the
  // question a bare rate can't: how much MORE penalty-free money (basis,
  // brokerage) would close the gap in a typical unlucky trial.
  const shortfallAmountsAmongAffected = penaltyAvoidedShortfallAmountsPV
    .filter((_, i) => hadPenaltyAvoidedShortfall[i])
    .sort((a, b) => a - b);
  const medianPenaltyAvoidedShortfallPV =
    shortfallAmountsAmongAffected.length > 0
      ? percentile(shortfallAmountsAmongAffected, 50)
      : 0;

  // Spending stability: % of trials where withdrawals met ≥75% of initial (inflation-adjusted)
  const spendingStabilityRate = safeDivide(spendingStableCount, numTrials, 0);

  // Budget stability: same metric but against user's retirement budget
  const budgetStabilityRate = safeDivide(budgetStableCount, numTrials, null);

  // Terminal balance stats
  const sortedTerminal = [...terminalBalances].sort((a, b) => a - b);
  const medianEndBalance = percentile(sortedTerminal, 50);
  const meanEndBalance =
    sumBy(terminalBalances, (v) => v) / Math.max(terminalBalances.length, 1);

  // Failure age distribution (null if fewer than 5% of trials fail)
  const failureAgeDist =
    failureAges.length >= numTrials * 0.05
      ? computeDistribution(failureAges)
      : null;

  // P5 worst-case
  const p5EndBalance = percentile(sortedTerminal, 5);
  const sortedTerminalToday = [...terminalBalancesToday].sort((a, b) => a - b);
  const sortedFailures = [...failureAges].sort((a, b) => a - b);
  const p5FailureAge =
    sortedFailures.length > 0 ? percentile(sortedFailures, 5) : null;
  const failureReasonRates = {
    depleted: safeDivide(failureReasonCounts.depleted, numTrials, 0),
    penaltyGap: safeDivide(failureReasonCounts.penaltyGap, numTrials, 0),
    shortfall: safeDivide(failureReasonCounts.shortfall, numTrials, 0),
  };

  return {
    medianPenaltyAvoidedShortfallPV,
    spendingStabilityRate,
    budgetStabilityRate,
    medianEndBalance,
    meanEndBalance,
    failureAgeDist,
    p5EndBalance,
    sortedTerminalToday,
    p5FailureAge,
    failureReasonRates,
  };
}
