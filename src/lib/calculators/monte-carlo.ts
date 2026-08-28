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
import { roundToCents, sumBy, safeDivide } from "../utils/math";
import {
  DEFAULT_RETURN_RATE,
  MC_RETURN_CLAMP_MIN,
  MC_RETURN_CLAMP_MAX,
  MC_SPENDING_STABILITY_THRESHOLD,
} from "../constants";
import type { EngineDecumulationYear } from "./types";
import { WITHDRAWAL_STRATEGY_CONFIG } from "../config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "../config/withdrawal-strategies";

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
  const clampMin = input.returnClampMin ?? MC_RETURN_CLAMP_MIN;
  const clampMax = input.returnClampMax ?? MC_RETURN_CLAMP_MAX;

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
  // v0.7.8 penalty-hard-exclusion follow-up
  // (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q3/C3, BLOCKING):
  // a trial whose spending need went unfunded specifically because
  // penalty-exposed money was excluded (not because the household was
  // broke) must NOT count as a success just because it kept a larger
  // terminal balance from money it never spent. Parallel array to
  // terminalBalances, indexed by trial.
  const hadPenaltyAvoidedShortfall: boolean[] = [];
  // Dollar magnitude alongside the boolean above -- per trial, the sum of
  // every decumulation year's penaltyAvoidedShortfall, in TODAY's dollars
  // (deflated by pvDeflator, same convention as sustainableWithdrawalsPV
  // below). Lets a caller answer "how much" a household is short by the
  // 55->59½ gap, not just "how often" -- a bare % rate doesn't tell anyone
  // what to actually go build. Only meaningful for trials where the
  // boolean above is true; 0 otherwise.
  const penaltyAvoidedShortfallAmountsPV: number[] = [];
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
      postRetirementInflationRate: inflationRisk
        ? trialInflationRate
        : engineInput.postRetirementInflationRate,
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

    // Penalty-avoided shortfall (§ Q3/C3) -- any decumulation year whose
    // spending need went unfunded because penalty-exposed money was
    // excluded disqualifies this trial from counting as a success below,
    // regardless of its terminal balance. Materiality floor (advisor
    // review, 2026-08-27, matching coast-fire.ts's identically-reasoned
    // `passes()` floor): a rounding-scale shortfall in one of many
    // decumulation years shouldn't disqualify an otherwise-successful
    // trial.
    hadPenaltyAvoidedShortfall.push(
      result.projectionByYear.some(
        (y) =>
          y.phase === "decumulation" &&
          (y.penaltyAvoidedShortfall ?? 0) >
            Math.max(50, (y.afterTaxNeed ?? 0) * 0.01),
      ),
    );
    const totalPenaltyAvoidedShortfallNominal = sumBy(
      result.projectionByYear,
      (y) =>
        y.phase === "decumulation" ? (y.penaltyAvoidedShortfall ?? 0) : 0,
    );
    penaltyAvoidedShortfallAmountsPV.push(
      safeDivide(totalPenaltyAvoidedShortfallNominal, pvDeflator, 0),
    );

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
            y.totalWithdrawal >= MC_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
      if (isStable) spendingStableCount++;

      // Budget stability: same check but against the user's ACTUAL per-year
      // budget (y.projectedExpenses — the engine's own real budget figure
      // for that specific year, already reflecting any raises/phase
      // changes the household's Budget Profile defines) rather than a
      // synthetic flat-inflation reprojection of the day-0 number. The old
      // reprojection could silently diverge from the real budget schedule
      // for any household with non-flat raises, making "budget stability"
      // partly an artifact of this metric's own approximation rather than
      // a real signal (found via live user confusion, 2026-08-28).
      if (retirementBudget !== null) {
        const isBudgetStable = decYears.every((y) => {
          const baseline = y.projectedExpenses;
          return (
            baseline === 0 ||
            y.totalWithdrawal >= MC_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
        if (isBudgetStable) budgetStableCount++;
      }
      // Per-year spending ratios for stability chart bands.
      for (let di = 0; di < decYears.length && di < numDecYears; di++) {
        const yr = decYears[di]!;
        const stratBase = strategyUsesRaise
          ? yr.targetWithdrawal
          : year1Withdrawal * Math.pow(1 + trialInflationRate, di);
        stratRatiosByDecYear[di]!.push(
          safeDivide(yr.totalWithdrawal, stratBase, 0),
        );
        if (retirementBudget !== null) {
          budgetRatiosByDecYear[di]!.push(
            safeDivide(yr.totalWithdrawal, yr.projectedExpenses, 0),
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
      safeDivide(result.sustainableWithdrawal, pvDeflator, 0),
    );
  }

  // Aggregate into percentile bands
  const percentileBands: MonteCarloPercentileBand[] = [];
  for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
    const balances = balancesByYear[yearIdx]!;
    if (balances.length === 0) continue;
    const sorted = [...balances].sort((a, b) => a - b);
    const mean = sumBy(balances, (v) => v) / balances.length;

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
    const stratMean = sumBy(stratRatios, (v) => v) / stratRatios.length;
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
      const budgetMean = sumBy(budgetRatios, (v) => v) / budgetRatios.length;
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

  // Success rate: % of trials where portfolio balance stays above $0 AND
  // no year's spending need went unfunded specifically because penalty-
  // exposed money was excluded (v0.7.8 penalty-hard-exclusion follow-up §
  // Q3/C3, BLOCKING) -- without the second condition, a trial that
  // under-spent every year (because its only remaining money was
  // penalty-exposed and off-limits) would keep a LARGER terminal balance
  // and score as MORE successful, exactly backwards.
  const successCount = terminalBalances.filter(
    (b, i) => b > 0 && !hadPenaltyAvoidedShortfall[i],
  ).length;
  const successRate = safeDivide(successCount, numTrials, 0);

  // Diagnostic split for the same signal: what fraction of trials hit a
  // penalty-avoided shortfall at all (regardless of terminal balance) --
  // lets a caller distinguish "can't legally reach the money before 59½"
  // from "genuinely ran out," which successRate alone conflates.
  const penaltyAvoidedShortfallCount =
    hadPenaltyAvoidedShortfall.filter(Boolean).length;
  const penaltyAvoidedShortfallRate = safeDivide(
    penaltyAvoidedShortfallCount,
    numTrials,
    0,
  );

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
  const budgetStabilityRate =
    retirementBudget !== null
      ? safeDivide(budgetStableCount, numTrials, null)
      : null;

  // Terminal balance stats
  const sortedTerminal = [...terminalBalances].sort((a, b) => a - b);
  const medianEndBalance = percentile(sortedTerminal, 50);
  const meanEndBalance =
    sumBy(terminalBalances, (v) => v) / Math.max(terminalBalances.length, 1);

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
    penaltyAvoidedShortfallRate,
    medianPenaltyAvoidedShortfallPV,
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
