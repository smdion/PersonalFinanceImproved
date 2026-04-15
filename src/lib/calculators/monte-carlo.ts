/**
 * Monte Carlo Retirement Simulation
 *
 * Pure calculator — no DB, no tRPC, no React.
 *
 * Wraps calculateProjection() × N trials with randomized return rates,
 * then aggregates results into percentile bands for fan chart visualization.
 *
 * Each trial generates a different sequence of annual returns by sampling from
 * correlated log-normal distributions based on asset class parameters and a
 * glide path that shifts allocations over time.
 */
import { calculateProjection } from "./engine";
import {
  createPRNG,
  sampleCorrelatedReturns,
  blendReturns,
  choleskyDecomposition,
  buildCorrelationMatrix,
  sampleNormalMeanStd,
} from "./random";
import type {
  MonteCarloInput,
  MonteCarloResult,
  MonteCarloPercentileBand,
  DistributionSummary,
  ProjectionInput,
} from "./types";
import { roundToCents } from "../utils/math";
import { DEFAULT_RETURN_RATE } from "../constants";
import type { EngineDecumulationYear } from "./types";
import { WITHDRAWAL_STRATEGY_CONFIG } from "../config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "../config/withdrawal-strategies";

/** A trial is "spending stable" if withdrawals stay ≥ this fraction of the initial
 *  inflation-adjusted withdrawal in every decumulation year. */
const SPENDING_STABILITY_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the percentile value from a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Compute summary statistics for a distribution. */
function computeDistribution(values: number[]): DistributionSummary {
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
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
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

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

/**
 * Run a Monte Carlo simulation over the projection engine.
 *
 * For each trial:
 * 1. Generate a random return rate sequence (correlated log-normal per asset class)
 * 2. Optionally randomize inflation
 * 3. Call calculateProjection() with those return rates
 * 4. Record end balance and depletion age
 *
 * Then aggregate all trials into percentile bands.
 */
export function calculateMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const startTime = performance.now();
  const warnings: string[] = [];

  const {
    engineInput,
    numTrials,
    assetClasses,
    correlations,
    glidePath,
    inflationRisk,
  } = input;
  const seed = input.seed ?? Date.now();
  const clampMin = input.returnClampMin ?? -0.5;
  const clampMax = input.returnClampMax ?? 1.0;

  // Strategy config — determines whether stability baseline uses post-retirement
  // raise (from engine's projectedExpenses) or MC inflation (computed baseline).
  const activeStrategy = (engineInput.decumulationDefaults
    ?.withdrawalStrategy ?? "fixed") as WithdrawalStrategyType;
  const strategyUsesRaise =
    WITHDRAWAL_STRATEGY_CONFIG[activeStrategy]?.usesPostRetirementRaise ?? true;

  // Validate inputs
  if (assetClasses.length === 0) {
    warnings.push(
      "No asset classes configured — using deterministic return rates for all trials",
    );
  }
  if (glidePath.length === 0) {
    warnings.push("No glide path configured — using equal-weight allocation");
  }

  // Check for missing correlation pairs
  if (assetClasses.length > 1) {
    const expectedPairs = (assetClasses.length * (assetClasses.length - 1)) / 2;
    const providedPairs = correlations.length;
    if (providedPairs < expectedPairs) {
      warnings.push(
        `Missing ${expectedPairs - providedPairs} of ${expectedPairs} correlation pairs — missing pairs default to 0 (uncorrelated)`,
      );
    }
  }

  // Pre-compute Cholesky decomposition for correlated sampling
  const correlationMatrix = buildCorrelationMatrix(assetClasses, correlations);
  const choleskyL = choleskyDecomposition(correlationMatrix);

  // Compute deterministic projection first (always returned for comparison)
  const deterministicProjection = calculateProjection(engineInput);

  // Projection parameters
  const startAge = engineInput.currentAge;
  const endAge = engineInput.projectionEndAge;
  const numYears = endAge - startAge + 1;

  // Storage for per-year balances across trials (year index → array of end balances)
  const balancesByYear: number[][] = Array.from({ length: numYears }, () => []);

  // Storage for per-decumulation-year spending ratios across trials
  // Index 0 = first decumulation year, not first projection year
  const numDecYears = Math.max(0, endAge - engineInput.retirementAge + 1);
  const stratRatiosByDecYear: number[][] = Array.from(
    { length: numDecYears },
    () => [],
  );
  const budgetRatiosByDecYear: number[][] = Array.from(
    { length: numDecYears },
    () => [],
  );

  // Per-trial outcome tracking
  const terminalBalances: number[] = [];
  const depletionAges: number[] = [];
  const sustainableWithdrawals: number[] = [];
  const sustainableWithdrawalsPV: number[] = [];
  let spendingStableCount = 0;
  let budgetStableCount = 0;

  // Budget baseline for budget stability metric (user's stated retirement expenses).
  // Falls back to annualExpenses when decumulationAnnualExpenses is omitted
  // (the server omits it when the decumulation budget matches accumulation).
  const retirementBudget =
    engineInput.decumulationAnnualExpenses ??
    engineInput.annualExpenses ??
    null;

  // Deflator for converting nominal retirement-year dollars to today's dollars
  const yearsToRetirement = engineInput.retirementAge - startAge;
  const pvDeflator = Math.pow(1 + engineInput.inflationRate, yearsToRetirement);

  // Run trials
  for (let trial = 0; trial < numTrials; trial++) {
    const rng = createPRNG(seed + trial);

    // Generate randomized return rates for this trial
    const trialReturnRates: { label: string; rate: number }[] = [];
    for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
      const age = startAge + yearIdx;
      let annualReturn: number;

      if (assetClasses.length > 0) {
        // Sample correlated returns for each asset class (log-normal, centered on asset class means)
        const assetReturns = sampleCorrelatedReturns(
          rng,
          assetClasses,
          choleskyL,
        );
        // Blend using glide path allocations at this age
        annualReturn = blendReturns(assetReturns, assetClasses, glidePath, age);
      } else {
        // Fallback: use the deterministic return rate
        const detRate = engineInput.returnRates.find((r) => {
          const ageMatch = r.label.match(/(\d+)/);
          return ageMatch && Number(ageMatch[1]) === age;
        });
        annualReturn = detRate?.rate ?? DEFAULT_RETURN_RATE;
      }

      // Clamp extreme returns (prevent unrealistic scenarios)
      annualReturn = Math.max(annualReturn, clampMin);
      annualReturn = Math.min(annualReturn, clampMax);

      trialReturnRates.push({ label: `Age ${age}`, rate: annualReturn });
    }

    // Optionally randomize inflation — draw per-year rates, pass geometric mean to engine.
    // This matches the methodology ("each year draws from a normal distribution") while
    // staying compatible with the engine's single-rate model. Per-year sampling prevents
    // unrealistic persistent extreme inflation scenarios (4%+ for 58 years).
    let trialInflationRate = engineInput.inflationRate;
    if (inflationRisk) {
      let logInflationSum = 0;
      for (let y = 0; y < numYears; y++) {
        const yearInflation = Math.max(
          0,
          sampleNormalMeanStd(
            rng,
            inflationRisk.meanRate,
            inflationRisk.stdDev,
          ),
        );
        logInflationSum += Math.log(1 + yearInflation);
      }
      trialInflationRate = Math.exp(logInflationSum / numYears) - 1;
    }

    // Build modified engine input for this trial.
    // Both inflationRate (accumulation) and postRetirementInflationRate (decumulation)
    // must use the trial's randomized inflation so the stochastic inflation control
    // affects portfolio longevity during retirement.
    const trialInput: ProjectionInput = {
      ...engineInput,
      returnRates: trialReturnRates,
      inflationRate: trialInflationRate,
      postRetirementInflationRate: trialInflationRate,
    };

    // Run the engine
    const result = calculateProjection(trialInput);

    // Collect per-year end balances
    for (
      let yearIdx = 0;
      yearIdx < numYears && yearIdx < result.projectionByYear.length;
      yearIdx++
    ) {
      balancesByYear[yearIdx]!.push(
        roundToCents(result.projectionByYear[yearIdx]!.endBalance),
      );
    }

    // Terminal balance
    const lastYear =
      result.projectionByYear[result.projectionByYear.length - 1];
    terminalBalances.push(roundToCents(lastYear?.endBalance ?? 0));

    // Depletion age
    if (result.portfolioDepletionAge !== null) {
      depletionAges.push(result.portfolioDepletionAge);
    }

    // Spending stability: did withdrawals stay ≥75% of baseline every decumulation year?
    // For strategies that use post-retirement raise (Fixed, Forgo, G-K, Decline),
    // use the engine's projectedExpenses as baseline — it already has the correct
    // inflation applied. For dynamic strategies (Vanguard, Const%, Endowment, RMD),
    // use year-1 withdrawal grown by MC inflation.
    const decYears = result.projectionByYear.filter(
      (y): y is EngineDecumulationYear => y.phase === "decumulation",
    );
    if (decYears.length > 0) {
      const year1Withdrawal = decYears[0]!.totalWithdrawal;
      const isStable =
        year1Withdrawal === 0 ||
        decYears.every((y, i) => {
          const baseline = strategyUsesRaise
            ? y.targetWithdrawal
            : year1Withdrawal * Math.pow(1 + trialInflationRate, i);
          // A depleted portfolio (both target and actual = 0) is NOT stable
          if (baseline === 0 && y.totalWithdrawal === 0 && i > 0) return false;
          return (
            baseline === 0 ||
            y.totalWithdrawal >= SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
      if (isStable) spendingStableCount++;

      // Budget stability: same check but against the user's retirement budget
      // (inflation-adjusted from today's dollars to each year's nominal dollars).
      // Use trialInflationRate (not the deterministic rate) so accumulation and
      // decumulation are in the same nominal frame within each trial.
      if (retirementBudget !== null) {
        const budgetAtRetirement =
          retirementBudget *
          Math.pow(1 + trialInflationRate, yearsToRetirement);
        const isBudgetStable =
          budgetAtRetirement === 0 ||
          decYears.every((y, i) => {
            const inflationFactor = Math.pow(1 + trialInflationRate, i);
            const baseline = budgetAtRetirement * inflationFactor;
            return y.totalWithdrawal >= SPENDING_STABILITY_THRESHOLD * baseline;
          });
        if (isBudgetStable) budgetStableCount++;
      }
      // Per-year spending ratios for stability chart bands.
      // Same trialInflationRate for consistency within each trial.
      const budgetAtRet =
        retirementBudget !== null
          ? retirementBudget *
            Math.pow(1 + trialInflationRate, yearsToRetirement)
          : null;
      for (let di = 0; di < decYears.length && di < numDecYears; di++) {
        const yr = decYears[di]!;
        const stratBase = strategyUsesRaise
          ? yr.targetWithdrawal
          : year1Withdrawal * Math.pow(1 + trialInflationRate, di);
        stratRatiosByDecYear[di]!.push(
          stratBase > 0 ? yr.totalWithdrawal / stratBase : 0,
        );
        if (budgetAtRet !== null) {
          const budgetInflFactor = Math.pow(1 + trialInflationRate, di);
          const budgetBase = budgetAtRet * budgetInflFactor;
          budgetRatiosByDecYear[di]!.push(
            budgetBase > 0 ? yr.totalWithdrawal / budgetBase : 0,
          );
        }
      }
    } else {
      spendingStableCount++; // no decumulation = vacuously stable
      if (retirementBudget !== null) budgetStableCount++;
    }

    // Sustainable withdrawal (nominal and present value)
    sustainableWithdrawals.push(result.sustainableWithdrawal);
    sustainableWithdrawalsPV.push(
      pvDeflator > 0 ? result.sustainableWithdrawal / pvDeflator : 0,
    );
  }

  // Aggregate into percentile bands
  const percentileBands: MonteCarloPercentileBand[] = [];
  for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
    const balances = balancesByYear[yearIdx]!;
    if (balances.length === 0) continue;
    const sorted = [...balances].sort((a, b) => a - b);
    const mean = balances.reduce((s, v) => s + v, 0) / balances.length;

    percentileBands.push({
      year: engineInput.asOfDate.getFullYear() + yearIdx,
      age: startAge + yearIdx,
      p5: percentile(sorted, 5),
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      mean,
    });
  }

  // Spending stability ratio bands (per decumulation year)
  const retirementStartAge = engineInput.retirementAge;
  const retirementStartYear =
    engineInput.asOfDate.getFullYear() + (retirementStartAge - startAge);

  const stratRatioBands: MonteCarloPercentileBand[] = [];
  const budgetRatioBands: MonteCarloPercentileBand[] = [];
  for (let di = 0; di < numDecYears; di++) {
    const stratRatios = stratRatiosByDecYear[di]!;
    if (stratRatios.length === 0) continue;
    const sortedStrat = [...stratRatios].sort((a, b) => a - b);
    const stratMean =
      stratRatios.reduce((s, v) => s + v, 0) / stratRatios.length;
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
    });

    const budgetRatios = budgetRatiosByDecYear[di]!;
    if (budgetRatios.length > 0) {
      const sortedBudget = [...budgetRatios].sort((a, b) => a - b);
      const budgetMean =
        budgetRatios.reduce((s, v) => s + v, 0) / budgetRatios.length;
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

  // Success rate: % of trials where portfolio balance stays above $0
  const successCount = terminalBalances.filter((b) => b > 0).length;
  const successRate = numTrials > 0 ? successCount / numTrials : 0;

  // Spending stability: % of trials where withdrawals met ≥75% of initial (inflation-adjusted)
  const spendingStabilityRate =
    numTrials > 0 ? spendingStableCount / numTrials : 0;

  // Budget stability: same metric but against user's retirement budget
  const budgetStabilityRate =
    retirementBudget !== null && numTrials > 0
      ? budgetStableCount / numTrials
      : null;

  // Terminal balance stats
  const sortedTerminal = [...terminalBalances].sort((a, b) => a - b);
  const medianEndBalance = percentile(sortedTerminal, 50);
  const meanEndBalance =
    terminalBalances.reduce((s, v) => s + v, 0) /
    Math.max(terminalBalances.length, 1);

  // Depletion age distribution (null if fewer than 5% of trials deplete)
  const depletionDist =
    depletionAges.length >= numTrials * 0.05
      ? computeDistribution(depletionAges)
      : null;

  // P5 worst-case
  const p5EndBalance = percentile(sortedTerminal, 5);
  const sortedDepletions = [...depletionAges].sort((a, b) => a - b);
  const p5DepletionAge =
    sortedDepletions.length > 0 ? percentile(sortedDepletions, 5) : null;

  const computeTimeMs = Math.round(performance.now() - startTime);

  return {
    successRate,
    spendingStabilityRate,
    budgetStabilityRate,
    spendingStabilityBands,
    medianEndBalance,
    meanEndBalance,
    percentileBands,
    deterministicProjection,
    distributions: {
      terminalBalance: computeDistribution(terminalBalances),
      depletionAge: depletionDist,
      sustainableWithdrawal: computeDistribution(sustainableWithdrawals),
      sustainableWithdrawalPV: computeDistribution(sustainableWithdrawalsPV),
    },
    worstCase: {
      p5DepletionAge,
      p5EndBalance,
    },
    numTrials,
    computeTimeMs,
    warnings,
  };
}
