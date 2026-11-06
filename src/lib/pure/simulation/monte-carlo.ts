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
import {
  planEndAge,
  planRetirementAge,
} from "@/lib/pure/household/household-timeline";
import { strategySpending } from "../retirement/strategy-spending";
import { assessPlan, type PlanFailureReason } from "../retirement/plan-outcome";
import { calculateProjection } from "../engine";
import { buildInflationPath } from "../engine/inflation-path";
import { gkAnchorRate } from "@/lib/pure/retirement/gk-anchor-rate";
import {
  createPRNG,
  sampleBlendedReturn,
  blendedReturnStats,
  choleskyDecomposition,
  buildCorrelationMatrix,
  sampleNormalMeanStd,
  type GlidePathEntry,
} from "./random";
import type {
  MonteCarloInput,
  MonteCarloResult,
  MonteCarloPercentileBand,
  DistributionSummary,
} from "./monte-carlo.types";
import type { ProjectionInput, EngineDecumulationYear } from "../engine/types";
import { roundToCents, sumBy, safeDivide } from "../../utils/math";
import {
  MC_RETURN_CLAMP_MIN,
  MC_RETURN_CLAMP_MAX,
  MC_SPENDING_STABILITY_THRESHOLD,
} from "../../constants";
import { WITHDRAWAL_STRATEGY_CONFIG } from "../../config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "../../config/withdrawal-strategies";

// ---------------------------------------------------------------------------
// Not configured
// ---------------------------------------------------------------------------

/** Why a Simulation can't run: its preset is missing, there are no asset
 *  classes to draw returns from, no glide path to mix them by age, or a
 *  glide-path age whose active-class weights don't add up to 100%. */
export type SimulationNotConfigured =
  "no_presets" | "no_asset_classes" | "no_glide_path" | "glide_path_mismatch";

/** What each not-configured state tells the household. */
export const SIMULATION_NOT_CONFIGURED_MESSAGE: Record<
  SimulationNotConfigured,
  string
> = {
  no_presets:
    "No simulation preset: the preset this runs on is missing, so the simulation can't run.",
  no_asset_classes:
    "No asset classes: the simulation has no returns to draw from, so it can't run.",
  no_glide_path:
    "No glide path: this preset has no mix by age, so the simulation can't run.",
  glide_path_mismatch:
    "The glide path doesn't add up to 100% at every age (an asset class may be inactive), so the simulation can't run.",
};

/** How far a glide-path age's active-class weights may sum from 100%. */
export const GLIDE_PATH_WEIGHT_TOLERANCE = 0.001;

/**
 * The one check for whether a Simulation can run, or null when it can.
 * `preset` is the run's preset (`found` false: a named preset the
 * database lacks — never run Custom's mix under its name); null when the
 * caller has none. Only active classes (`assetClasses`) count toward a
 * glide-path age's weights.
 */
export function simulationNotConfigured(
  preset: { found: boolean } | null,
  assetClasses: readonly { id: number }[],
  glidePath: readonly GlidePathEntry[],
): SimulationNotConfigured | null {
  if (preset && !preset.found) return "no_presets";
  if (assetClasses.length === 0) return "no_asset_classes";
  if (glidePath.length === 0) return "no_glide_path";
  const active = new Set(assetClasses.map((c) => c.id));
  const sums = glidePath.map((g) =>
    sumBy(
      Object.entries(g.allocations).filter(([id]) => active.has(Number(id))),
      ([, w]) => w,
    ),
  );
  if (sums.every((w) => w <= 0)) return "no_glide_path";
  if (sums.some((w) => Math.abs(w - 1) > GLIDE_PATH_WEIGHT_TOLERANCE))
    return "glide_path_mismatch";
  return null;
}

/** Thrown by calculateMonteCarlo when it can't run; callers check
 *  simulationNotConfigured first and show the state instead. */
export class SimulationNotConfiguredError extends Error {
  constructor(readonly reason: SimulationNotConfigured) {
    super(SIMULATION_NOT_CONFIGURED_MESSAGE[reason]);
    this.name = "SimulationNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the percentile value from a sorted array. */
export function percentile(sorted: number[], p: number): number {
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
 * 2. Optionally randomize inflation around the household's own rates
 * 3. Call calculateProjection() with those return rates
 * 4. Record end balance and depletion age
 *
 * Then aggregate all trials into percentile bands.
 *
 * `onProgress`, if given, is called periodically (not every trial — every
 * ~2% of numTrials, to keep the overhead of the callback itself negligible
 * against the loop it's instrumenting) with the trial count completed so
 * far. It's a plain in-process callback — callers running this off-thread
 * (see `src/workers/monte-carlo-worker.ts`) wire their OWN callback that
 * posts a worker message; never pass a caller-supplied function through
 * `postMessage` itself, since a function reference can't survive
 * structured clone.
 */
export function calculateMonteCarlo(
  input: MonteCarloInput,
  onProgress?: (done: number, total: number) => void,
): MonteCarloResult {
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

  // Nothing to draw returns from. (A mix off 100% is refused by the
  // routers, which check the household's own glide path.)
  const notConfigured = simulationNotConfigured(null, assetClasses, glidePath);
  if (notConfigured === "no_asset_classes" || notConfigured === "no_glide_path")
    throw new SimulationNotConfiguredError(notConfigured);

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
  const endAge = planEndAge(engineInput);
  const numYears = endAge - startAge + 1;

  // Storage for per-year balances across trials (year index → array of end
  // balances), nominal and in today's dollars — each trial deflated by its
  // own inflation before sorting, never the percentiles afterwards.
  const balancesByYear: number[][] = Array.from({ length: numYears }, () => []);
  const balancesTodayByYear: number[][] = Array.from(
    { length: numYears },
    () => [],
  );

  // Storage for per-decumulation-year spending ratios across trials
  // Index 0 = first decumulation year, not first projection year
  const numDecYears = Math.max(0, endAge - planRetirementAge(engineInput) + 1);
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
  const terminalBalancesToday: number[] = [];
  // Trials that failed on a penalty gap (money there but locked behind
  // early-withdrawal penalties), and every trial's verdict. Parallel arrays
  // to terminalBalances, indexed by trial.
  const hadPenaltyAvoidedShortfall: boolean[] = [];
  const trialSucceeded: boolean[] = [];
  // Dollar magnitude alongside the boolean above -- per trial, the sum of
  // every decumulation year's penaltyAvoidedShortfall, in TODAY's dollars
  // (deflated by pvDeflator, same convention as sustainableWithdrawalsPV
  // below). Lets a caller answer "how much" a household is short by the
  // 55->59½ gap, not just "how often" -- a bare % rate doesn't tell anyone
  // what to actually go build. Only meaningful for trials where the
  // boolean above is true; 0 otherwise.
  const penaltyAvoidedShortfallAmountsPV: number[] = [];
  const failureAges: number[] = [];
  const failureReasonCounts: Record<PlanFailureReason, number> = {
    depleted: 0,
    penaltyGap: 0,
    shortfall: 0,
  };
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
  // Each trial's price level by year, for the assumptions on the bands.
  const tracksGkAnchor =
    engineInput.decumulationDefaults.withdrawalStrategy === "guyton_klinger";
  const gkAnchorRates: number[] = [];
  const priceLevelsByYear: number[][] = Array.from(
    { length: numYears },
    () => [],
  );

  const yearsToRetirement = planRetirementAge(engineInput) - startAge;
  // The household's own rates — each trial's inflation varies around them.
  const baseInflation = engineInput.inflationRate;
  const basePostRetirementInflation =
    engineInput.postRetirementInflationRate ?? baseInflation;

  // Report progress every ~2% of trials (min every 20 trials) so the
  // callback overhead never becomes noticeable against the loop itself,
  // while still giving a caller something to show a determinate "N/total"
  // state with.
  const progressInterval = Math.max(1, Math.floor(numTrials / 50));

  // Run trials
  for (let trial = 0; trial < numTrials; trial++) {
    if (
      onProgress &&
      (trial % progressInterval === 0 || trial === numTrials - 1)
    ) {
      onProgress(trial, numTrials);
    }
    const rng = createPRNG(seed + trial);

    // Generate randomized return rates for this trial
    const trialReturnRates: { label: string; rate: number }[] = [];
    for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
      const age = startAge + yearIdx;
      // Correlated log-normal draws, centered on the asset class means and
      // blended by this age's glide path.
      let annualReturn = sampleBlendedReturn(
        rng,
        assetClasses,
        choleskyL,
        glidePath,
        age,
      );

      // Clamp extreme returns (prevent unrealistic scenarios)
      annualReturn = Math.max(annualReturn, clampMin);
      annualReturn = Math.min(annualReturn, clampMax);

      trialReturnRates.push({ label: `Age ${age}`, rate: annualReturn });
    }

    // Optionally randomize inflation: a shock per year around the
    // household's own rates. One shock path moves both rates, keeping the
    // household's gap between the post-retirement raise and inflation, and
    // the engine reads the same path. No spread = no shocks, exactly the
    // plan's rates.
    const inflationShocks =
      inflationRisk && inflationRisk.stdDev > 0
        ? Array.from({ length: numYears }, () =>
            sampleNormalMeanStd(rng, 0, inflationRisk.stdDev),
          )
        : undefined;
    const trialInflation = buildInflationPath({
      inflationRate: baseInflation,
      postRetirementInflationRate: basePostRetirementInflation,
      baseYear: engineInput.asOfDate.getFullYear(),
      shocks: inflationShocks,
    });
    // Today's dollars for this trial: deflated by the inflation it ran with
    // (the app's convention — the general rate, every year), so a hot trial
    // reads poorer in today's dollars than a cool one with the same balance.
    const todayDeflator = (yearIdx: number) => trialInflation.growth(yearIdx);
    if (inflationShocks)
      for (let yearIdx = 0; yearIdx < numYears; yearIdx++)
        priceLevelsByYear[yearIdx]!.push(todayDeflator(yearIdx));
    const pvDeflator = todayDeflator(yearsToRetirement);

    // Build modified engine input for this trial.
    const trialInput: ProjectionInput = {
      ...engineInput,
      returnRates: trialReturnRates,
      inflationShocks,
    };

    // Run the engine
    const result = calculateProjection(trialInput);

    // Collect per-year end balances.
    // Retirement money (A6): Portfolio balances never fund retirement, so
    // the bands, median and terminal balances leave them out.
    for (
      let yearIdx = 0;
      yearIdx < numYears && yearIdx < result.projectionByYear.length;
      yearIdx++
    ) {
      const balance = result.projectionByYear[yearIdx]!.retirementBalance;
      balancesByYear[yearIdx]!.push(roundToCents(balance));
      balancesTodayByYear[yearIdx]!.push(
        roundToCents(balance / todayDeflator(yearIdx)),
      );
    }

    // Terminal balance
    const lastIdx = result.projectionByYear.length - 1;
    const lastYear = result.projectionByYear[lastIdx];
    terminalBalances.push(roundToCents(lastYear?.retirementBalance ?? 0));
    terminalBalancesToday.push(
      roundToCents((lastYear?.retirementBalance ?? 0) / todayDeflator(lastIdx)),
    );

    // One judge (plan-outcome.ts): the trial fails when retirement money
    // runs out or a year's spending goes unmet (money penalty-locked, only
    // in Portfolio accounts, or past what routing can reach) — never kept
    // alive by a terminal balance it couldn't spend. A penalty gap is also
    // tallied on its own below.
    const outcome = assessPlan(result);
    trialSucceeded.push(outcome.succeeded);
    hadPenaltyAvoidedShortfall.push(outcome.failureReason === "penaltyGap");
    // Each year's shortfall in today's dollars by its own year — summing
    // nominal years and dividing once by the retirement-year deflator gave
    // retirement-year dollars.
    penaltyAvoidedShortfallAmountsPV.push(
      result.projectionByYear.reduce(
        (sum, y, i) =>
          y.phase === "decumulation"
            ? sum + (y.penaltyAvoidedShortfall ?? 0) / todayDeflator(i)
            : sum,
        0,
      ),
    );

    // Failure age and reason (the plan judge's, not depletion alone).
    if (!outcome.succeeded) {
      failureAges.push(outcome.failureAge);
      failureReasonCounts[outcome.failureReason]++;
    }

    // Spending stability: did withdrawals stay ≥75% of baseline every decumulation year?
    // For strategies that use post-retirement raise (Fixed, Forgo, G-K, Decline),
    // use the engine's projectedExpenses as baseline — it already has the correct
    // inflation applied. For dynamic strategies (Vanguard, Const%, Endowment, RMD),
    // use year-1 withdrawal grown by the trial's general inflation — "did
    // spending hold in real terms" is a price question, and these
    // strategies don't use the post-retirement raise.
    if (tracksGkAnchor) {
      const anchor = gkAnchorRate(result.projectionByYear);
      if (anchor !== null) gkAnchorRates.push(anchor);
    }
    const decYears = result.projectionByYear.filter(
      (y): y is EngineDecumulationYear => y.phase === "decumulation",
    );
    if (decYears.length > 0) {
      const year1Withdrawal = decYears[0]!.totalWithdrawal;
      // Year 1's withdrawal, kept up with the inflation this trial saw.
      const firstDecIdx =
        decYears[0]!.year - engineInput.asOfDate.getFullYear();
      const inflatedYear1 = (i: number) =>
        year1Withdrawal *
        trialInflation.growthBetween(firstDecIdx, firstDecIdx + i);
      const isStable =
        year1Withdrawal === 0 ||
        decYears.every((y, i) => {
          const baseline = strategyUsesRaise
            ? y.targetWithdrawal
            : inflatedYear1(i);
          // A depleted portfolio (both target and actual = 0) is NOT stable
          if (baseline === 0 && y.totalWithdrawal === 0 && i > 0) return false;
          return (
            baseline === 0 ||
            y.totalWithdrawal >= MC_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
      if (isStable) spendingStableCount++;

      // Budget stability: same check but against the user's ACTUAL per-year
      // budget (y.budgetOnlyExpenses — the engine's own real budget figure
      // for that specific year, already reflecting any raises/phase
      // changes the household's Budget Profile defines, and NEVER mutated
      // by a reactive strategy's guardrail adjustment) rather than a
      // synthetic flat-inflation reprojection of the day-0 number.
      // y.projectedExpenses looked right but isn't: for Guyton-Klinger/
      // Forgo/Spending-Decline it's overwritten by that strategy's own
      // guardrail target every year, which silently collapsed "vs budget"
      // into being identical to "vs strategy" (both KPI rings showing the same percentage).
      // Compared with what the strategy has the household spend
      // (strategySpending) — the budget is spending, while the gross
      // withdrawal is net of Social Security and gross of tax.
      if (retirementBudget !== null) {
        const isBudgetStable = decYears.every((y) => {
          const baseline = y.budgetOnlyExpenses;
          return (
            baseline === 0 ||
            strategySpending(y) >= MC_SPENDING_STABILITY_THRESHOLD * baseline
          );
        });
        if (isBudgetStable) budgetStableCount++;
      }
      // Per-year spending ratios for stability chart bands.
      for (let di = 0; di < decYears.length && di < numDecYears; di++) {
        const yr = decYears[di]!;
        const stratBase = strategyUsesRaise
          ? yr.targetWithdrawal
          : inflatedYear1(di);
        stratRatiosByDecYear[di]!.push(
          safeDivide(yr.totalWithdrawal, stratBase, 0),
        );
        if (retirementBudget !== null) {
          budgetRatiosByDecYear[di]!.push(
            safeDivide(strategySpending(yr), yr.budgetOnlyExpenses, 0),
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
  onProgress?.(numTrials, numTrials);

  const sortedAnchors = [...gkAnchorRates].sort((a, b) => a - b);
  const gkAnchorRange =
    sortedAnchors.length > 0
      ? {
          p25: percentile(sortedAnchors, 25),
          p75: percentile(sortedAnchors, 75),
        }
      : null;

  const assumptionsFor = (yearIdx: number) => {
    const stats = blendedReturnStats(
      assetClasses,
      correlationMatrix,
      glidePath,
      startAge + yearIdx,
    );
    if (!stats) return {};
    const levels = [...(priceLevelsByYear[yearIdx] ?? [])].sort(
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
    const retired = yearIdx >= yearsToRetirement;
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
      ...assumptionsFor(yearIdx),
    });
  }

  // The same bands in today's dollars — each trial deflated before sorting.
  const percentileBandsToday: MonteCarloPercentileBand[] = [];
  for (let yearIdx = 0; yearIdx < numYears; yearIdx++) {
    const balances = balancesTodayByYear[yearIdx]!;
    if (balances.length === 0) continue;
    const sorted = [...balances].sort((a, b) => a - b);
    percentileBandsToday.push({
      year: engineInput.asOfDate.getFullYear() + yearIdx,
      age: startAge + yearIdx,
      p5: percentile(sorted, 5),
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      mean: sumBy(balances, (v) => v) / balances.length,
      ...assumptionsFor(yearIdx),
    });
  }

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

  // Success rate: % of trials the plan judge passes (assessPlan).
  const successCount = trialSucceeded.filter(Boolean).length;
  const successRate = safeDivide(successCount, numTrials, 0);

  // Diagnostic split: what fraction of trials failed on a penalty gap --
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
      failureAge: failureAgeDist,
      sustainableWithdrawal: computeDistribution(sustainableWithdrawals),
      sustainableWithdrawalPV: computeDistribution(sustainableWithdrawalsPV),
    },
    failureReasonRates,
    worstCase: {
      p5FailureAge,
      p5EndBalance,
    },
    today: {
      percentileBands: percentileBandsToday,
      terminalBalance: computeDistribution(terminalBalancesToday),
      medianEndBalance: percentile(sortedTerminalToday, 50),
      p5EndBalance: percentile(sortedTerminalToday, 5),
    },
    numTrials,
    computeTimeMs,
    warnings,
  };
}
