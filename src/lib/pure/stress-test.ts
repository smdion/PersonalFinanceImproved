/**
 * Stress test parameter sets for retirement projections (v0.5 expert-review M2).
 *
 * The audit's concern: ledgr accepts user-set return / inflation / salary-growth
 * assumptions with no historical context. A user with rosy assumptions doesn't
 * see the downside. This module exports canonical "conservative" and "optimistic"
 * parameter sets that any UI can pass into the projection engine to render a
 * side-by-side stress test.
 *
 * The numbers below are conservative tail-risk values, not point estimates.
 * They map roughly to the bottom decile of historical 30-year US equity returns
 * after taxes + fees, with elevated inflation and zero real salary growth.
 *
 * NOTE: this module is parameter-only. The UI is responsible for re-running
 * the projection with these inputs and rendering a comparison view.
 */

export interface StressTestParams {
  /** Nominal annual return rate (e.g. 0.05 = 5%). */
  returnRate: number;
  /** Annual inflation rate (e.g. 0.04 = 4%). */
  inflationRate: number;
  /** Annual real salary growth rate (e.g. 0.0 = 0% real growth). */
  salaryGrowthRate: number;
  /** Withdrawal-rate cushion (e.g. 0.035 = 3.5% safe withdrawal). */
  withdrawalRate: number;
  /** Human-readable label for the UI. */
  label: string;
  /** One-line description of the scenario for the UI tooltip. */
  description: string;
}

/**
 * Conservative tail-risk scenario. Approximates the bottom decile of
 * historical US 30-year equity outcomes plus elevated inflation. Use this
 * to ask "what if my real-world experience matches the worst 10% of
 * history?".
 */
export const STRESS_TEST_CONSERVATIVE: StressTestParams = {
  returnRate: 0.05, // 5% nominal — matches Trinity Study tail
  inflationRate: 0.04, // 4% — early-1980s elevated inflation
  salaryGrowthRate: 0.0, // 0% real — no career upside
  withdrawalRate: 0.035, // 3.5% — safer than the 4% rule
  label: "Conservative stress test",
  description:
    "Bottom-decile 30-year returns, elevated inflation, no real salary growth, " +
    "3.5% withdrawal. Asks: what if I get unlucky?",
};

/**
 * Optimistic scenario for the upper bound of the stress test. Matches
 * roughly the top quartile of historical US 30-year equity returns with
 * benign inflation and steady salary growth.
 */
export const STRESS_TEST_OPTIMISTIC: StressTestParams = {
  returnRate: 0.09, // 9% nominal — top quartile
  inflationRate: 0.02, // 2% — Fed target
  salaryGrowthRate: 0.02, // 2% real — career growth
  withdrawalRate: 0.04, // 4% rule
  label: "Optimistic baseline",
  description:
    "Top-quartile 30-year returns, benign 2% inflation, 2% real salary growth, " +
    "4% withdrawal. Asks: what if the next 30 years look like the best stretches?",
};

/**
 * The default-good scenario most users start from. Uses long-run averages.
 */
export const STRESS_TEST_BASELINE: StressTestParams = {
  returnRate: 0.07, // 7% nominal — long-run real ~5% + inflation 2%
  inflationRate: 0.03, // 3% — long-run US average
  salaryGrowthRate: 0.01, // 1% real
  withdrawalRate: 0.04,
  label: "Long-run baseline",
  description:
    "Long-run US averages: 7% nominal return, 3% inflation, 1% real salary " +
    "growth, 4% withdrawal. The default if you don't override.",
};

/**
 * Convenience: get all three scenarios in display order
 * (conservative → baseline → optimistic). UI can map over this for the
 * side-by-side stress test view.
 */
export function getStressTestScenarios(): StressTestParams[] {
  return [
    STRESS_TEST_CONSERVATIVE,
    STRESS_TEST_BASELINE,
    STRESS_TEST_OPTIMISTIC,
  ];
}

/**
 * Detect whether a user-supplied set of assumptions is "rosy" relative to
 * historical norms. Returns warning flags the UI can surface to nudge the
 * user to run the conservative stress test before committing to the plan.
 *
 * Thresholds:
 *   - returnRate > 8% (top quartile sustained → unlikely)
 *   - inflationRate < 2.5% (below historical floor)
 *   - salaryGrowthRate > 4% (very aggressive career projection)
 */
export interface RosyAssumptionFlag {
  field: "returnRate" | "inflationRate" | "salaryGrowthRate";
  userValue: number;
  threshold: number;
  message: string;
}

export function detectRosyAssumptions(
  returnRate: number,
  inflationRate: number,
  salaryGrowthRate: number,
): RosyAssumptionFlag[] {
  const flags: RosyAssumptionFlag[] = [];

  if (returnRate > 0.08) {
    flags.push({
      field: "returnRate",
      userValue: returnRate,
      threshold: 0.08,
      message:
        `Your assumed return rate (${(returnRate * 100).toFixed(1)}%) is above ` +
        `the long-run historical average for US equities (~7% nominal). ` +
        `Sustained 8%+ over 30 years is in the top quartile of history. ` +
        `Run the Conservative Stress Test to see how the plan holds up if ` +
        `returns are lower.`,
    });
  }

  if (inflationRate < 0.025) {
    flags.push({
      field: "inflationRate",
      userValue: inflationRate,
      threshold: 0.025,
      message:
        `Your inflation assumption (${(inflationRate * 100).toFixed(1)}%) is ` +
        `below the long-run US historical average (~3%). The 1970s saw ` +
        `9–14%; 2021–2023 saw 6–9%. Consider running the stress test at ` +
        `4% inflation to see the downside.`,
    });
  }

  if (salaryGrowthRate > 0.04) {
    flags.push({
      field: "salaryGrowthRate",
      userValue: salaryGrowthRate,
      threshold: 0.04,
      message:
        `Your assumed salary growth rate (${(salaryGrowthRate * 100).toFixed(1)}%) ` +
        `is above 4% per year. Career growth slows after early career and ` +
        `can stall during recessions. Consider running the stress test at ` +
        `0% real growth.`,
    });
  }

  return flags;
}
