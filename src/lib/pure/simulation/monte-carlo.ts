/**
 * Retirement Simulation: calculateProjection() × N trials, each with its own sequence of returns
 * drawn from correlated log-normal asset-class distributions along a glide path, aggregated into
 * percentile bands for the fan chart.
 */
import {
  choleskyDecomposition,
  buildCorrelationMatrix,
  type GlidePathEntry,
} from "./random";
import type { MonteCarloInput, MonteCarloResult } from "./monte-carlo.types";
import {
  percentile,
  computeDistribution,
  balanceBands,
  stabilityBands,
  trialOutcomes,
} from "./trial-summary";
import { runTrials } from "./trial-run";
import { sumBy, safeDivide } from "../../utils/math";
import {
  SIMULATION_RETURN_CLAMP_MIN,
  SIMULATION_RETURN_CLAMP_MAX,
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
 * The one check for whether a Simulation can run (null when it can). `preset.found` false is a
 * named preset the database lacks (never run Custom's mix under its name); null means no preset.
 * Only active `assetClasses` count toward a glide-path age's weights.
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
// Core simulation
// ---------------------------------------------------------------------------

/**
 * Runs the Simulation: per trial, correlated log-normal returns (and optionally inflation around
 * the household's rates) through calculateProjection(), then percentile bands. `onProgress` runs
 * every ~2% of trials, in-process; a worker wraps it in its own postMessage callback.
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
    glidePath,
    inflationRisk,
    seed,
    clampMin,
    clampMax,
    strategyUsesRaise,
    correlationMatrix,
    choleskyL,
  } = trialSetup(input, warnings);
  const {
    deterministicProjection,
    startAge,
    numYears,
    balancesByYear,
    balancesTodayByYear,
    numDecumulationYears,
    stratRatiosByDecumulationYear,
    budgetRatiosByDecumulationYear,
    terminalBalances,
    terminalBalancesToday,
    hadPenaltyAvoidedShortfall,
    trialSucceeded,
    penaltyAvoidedShortfallAmountsPV,
    failureAges,
    failureReasonCounts,
    sustainableWithdrawals,
    sustainableWithdrawalsPV,
    spendingStableCount,
    budgetStableCount,
    gkAnchorRates,
    priceLevelsByYear,
    yearsToRetirement,
  } = runTrials(
    engineInput,
    numTrials,
    onProgress,
    seed,
    assetClasses,
    choleskyL,
    glidePath,
    clampMin,
    clampMax,
    inflationRisk,
    strategyUsesRaise,
  );
  const { percentileBands, percentileBandsToday } = balanceBands(
    gkAnchorRates,
    assetClasses,
    correlationMatrix,
    glidePath,
    startAge,
    priceLevelsByYear,
    inflationRisk,
    yearsToRetirement,
    numYears,
    balancesByYear,
    engineInput,
    balancesTodayByYear,
  );
  const { spendingStabilityBands } = stabilityBands(
    engineInput,
    numDecumulationYears,
    stratRatiosByDecumulationYear,
    budgetRatiosByDecumulationYear,
  );
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

  const {
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
  } = trialOutcomes(
    hadPenaltyAvoidedShortfall,
    penaltyAvoidedShortfallAmountsPV,
    spendingStableCount,
    numTrials,
    budgetStableCount,
    terminalBalances,
    failureAges,
    terminalBalancesToday,
    failureReasonCounts,
  );

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

function trialSetup(input: MonteCarloInput, warnings: string[]) {
  const {
    engineInput,
    numTrials,
    assetClasses,
    correlations,
    glidePath,
    inflationRisk,
  } = input;
  const seed = input.seed;
  const clampMin = input.returnClampMin ?? SIMULATION_RETURN_CLAMP_MIN;
  const clampMax = input.returnClampMax ?? SIMULATION_RETURN_CLAMP_MAX;

  // Strategy config — determines whether stability baseline uses post-retirement
  // raise (from engine's projectedExpenses) or MC inflation (computed baseline).
  const activeStrategy = (engineInput.decumulationDefaults.withdrawalStrategy ??
    "fixed") as WithdrawalStrategyType;
  const strategyUsesRaise =
    // The stored strategy is a varchar, cast here: an unknown key reads undefined.
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

  return {
    engineInput,
    numTrials,
    assetClasses,
    glidePath,
    inflationRisk,
    seed,
    clampMin,
    clampMax,
    strategyUsesRaise,
    correlationMatrix,
    choleskyL,
  };
}
