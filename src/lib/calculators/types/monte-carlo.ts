// Monte Carlo simulation types.

import type { ProjectionInput, ProjectionResult } from "./engine-projection";

/** Per-year percentile band for fan chart rendering. */
export type MonteCarloPercentileBand = {
  year: number;
  age: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
};

/** Summary statistics for a distribution of outcomes. */
export type DistributionSummary = {
  min: number;
  p5: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
  stdDev: number;
};

/** Input to the Monte Carlo simulation. */
export type MonteCarloInput = {
  /** The base engine input (deterministic scenario). */
  engineInput: ProjectionInput;

  /** Number of simulation trials (default 1000). */
  numTrials: number;
  /** Seed for reproducibility (optional, uses Date.now() if not provided). */
  seed?: number;

  /** Asset class parameters for return modeling. */
  assetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];

  /** Correlation data between asset classes. */
  correlations: {
    classAId: number;
    classBId: number;
    correlation: number;
  }[];

  /** Glide path: allocation by age (sorted by age ascending). */
  glidePath: {
    age: number;
    allocations: Record<number, number>;
  }[];

  /** Optional inflation randomization. */
  inflationRisk?: {
    meanRate: number;
    stdDev: number;
  };

  /** Min return clamp per year (default -0.5 = max 50% loss). */
  returnClampMin?: number;
  /** Max return clamp per year (default 1.0 = max 100% gain). */
  returnClampMax?: number;
};

/** Full result from a Monte Carlo simulation. */
export type MonteCarloResult = {
  /** % of trials where portfolio balance stays above $0 through projection end. */
  successRate: number;
  /** % of trials where withdrawals stayed ≥75% of initial inflation-adjusted withdrawal in every decumulation year. */
  spendingStabilityRate: number;
  /** % of trials where withdrawals stayed ≥75% of the user's retirement budget (inflation-adjusted) in every decumulation year.
   *  Null when no retirement budget is set (decumulationAnnualExpenses not provided). */
  budgetStabilityRate: number | null;
  /** % of trials that failed `successRate`'s bar specifically because a
   *  year's spending need went unfunded due to `avoidPenalizedWithdrawals`
   *  excluding penalty-exposed money (v0.7.8 penalty-hard-exclusion follow-up,
   *  C3) — as opposed to genuinely running out of money. Distinguishes "this
   *  household can't legally reach its own savings before 59½" from "this
   *  household is broke," which look identical in `successRate` alone. */
  penaltyAvoidedShortfallRate: number;
  /** Median total shortfall (today's dollars) among ONLY the trials that hit
   *  a penalty-avoided shortfall — "how much," not just "how often." Answers
   *  what a bare rate can't: roughly how much MORE penalty-free money
   *  (basis, brokerage) would close the gap in a typical affected trial.
   *  0 when `penaltyAvoidedShortfallRate` is 0. */
  medianPenaltyAvoidedShortfallPV: number;
  /** 50th percentile terminal balance. */
  medianEndBalance: number;
  /** Average terminal balance. */
  meanEndBalance: number;

  /** Percentile bands for fan chart (one entry per projection year). */
  percentileBands: MonteCarloPercentileBand[];

  /** The deterministic projection (current engine output) for comparison. */
  deterministicProjection: ProjectionResult;

  /** Distribution of key outcomes. */
  distributions: {
    terminalBalance: DistributionSummary;
    depletionAge: DistributionSummary | null;
    sustainableWithdrawal: DistributionSummary;
    /** Sustainable withdrawal deflated to today's dollars. */
    sustainableWithdrawalPV: DistributionSummary;
  };

  /** Worst-case analysis. */
  worstCase: {
    p5DepletionAge: number | null;
    p5EndBalance: number;
  };

  /** Percentile bands for spending stability chart (ratio values, not dollars).
   *  Each band's p-values represent withdrawal/baseline ratios (e.g., p25=0.82
   *  means 25th percentile of trials had spending at 82% of baseline).
   *  Null when there are no decumulation years. */
  spendingStabilityBands: {
    /** Bands for vs-Strategy ratio (withdrawal / year-1 inflation-adjusted withdrawal). */
    stratRatio: MonteCarloPercentileBand[];
    /** Bands for vs-Budget ratio (withdrawal / retirement budget inflation-adjusted). Null when no budget set. */
    budgetRatio: MonteCarloPercentileBand[] | null;
  } | null;

  /** Metadata. */
  numTrials: number;
  computeTimeMs: number;
  warnings: string[];
};
