/**
 * Net Worth Calculator
 *
 * Computes total net worth in two views and two financial health benchmarks:
 *
 * **Net Worth Views:**
 *   - **NW+** (optimistic): Uses current estimated market value for home
 *   - **NW-** (conservative): Uses purchase price + cumulative improvements for home
 *   Both views share the same portfolio, cash, other assets, and liabilities.
 *
 * **Benchmarks:**
 *
 * 1. **Wealth Score** (savings efficiency):
 *    Wealth Score = Net Worth / Lifetime Earnings
 *    - Measures what fraction of cumulative earnings you've retained
 *    - Displayed as a percentage (e.g. 56% = kept 56% of everything earned)
 *
 * 2. **AAW Score** (Money Guy Show "Wealth Accumulator" formula):
 *    Expected Net Worth = (Average Age × Effective Income) / (10 + max(0, 40 - Age))
 *    - Uses average age across all household members
 *    - Uses combinedAgi (optionally 3-year averaged) as income
 *    - >= 2.0 = PAW (Prodigious), 1.0 = AAW (Average), <= 0.5 = UAW (Under)
 *
 * 3. **FI Progress** (Financial Independence progress):
 *    FI Target = Annual Expenses ÷ Withdrawal Rate
 *    - Withdrawal rate is a decimal (e.g. 0.04 for the 4% rule)
 *    - FI Progress = Net Worth ÷ FI Target (1.0 = financially independent)
 *
 * All division operations use safeDivide() to handle zero-income or zero-target edge cases.
 */
import type { NetWorthInput, NetWorthResult } from "./types";
import { safeDivide } from "../utils/math";
import {
  WEALTH_FORMULA_AGE_CUTOFF,
  WEALTH_FORMULA_BASE_DENOMINATOR,
} from "../constants";

export function calculateNetWorth(input: NetWorthInput): NetWorthResult {
  const warnings: string[] = [];
  const {
    portfolioTotal,
    cash,
    homeValueEstimated,
    homeValueConservative,
    otherAssets,
    mortgageBalance,
    otherLiabilities,
    averageAge,
    effectiveIncome,
    lifetimeEarnings,
    annualExpenses,
    withdrawalRate,
  } = input;

  // Warn if mortgage exists but no home value — net worth appears artificially negative
  if (
    mortgageBalance > 0 &&
    homeValueEstimated === 0 &&
    homeValueConservative === 0
  ) {
    warnings.push(
      `Mortgage balance of $${mortgageBalance.toLocaleString()} exists but home value is $0. ` +
        `Net worth may appear artificially negative. Set a home value in mortgage settings.`,
    );
  }

  // Non-home assets (shared between NW+ and NW-)
  const liquidAssets = portfolioTotal + cash + otherAssets;
  const totalLiabilities = mortgageBalance + otherLiabilities;

  // Market value NW: uses current estimated market value for home
  const netWorthMarket = liquidAssets + homeValueEstimated - totalLiabilities;

  // Cost basis NW: uses purchase price + cumulative improvements for home
  const netWorthCostBasis =
    liquidAssets + homeValueConservative - totalLiabilities;

  // Primary display uses market value
  const netWorth = netWorthMarket;
  const totalAssets = liquidAssets + homeValueEstimated;

  // Wealth Score: net worth as % of lifetime earnings (savings efficiency)
  const wealthScore = Number(safeDivide(netWorth, lifetimeEarnings) ?? 0);

  // AAW Score: Money Guy formula — (avgAge × income) / (10 + yearsUntil40)
  // Score >= 2.0 = PAW, 1.0 = AAW, <= 0.5 = UAW (thresholds, not in formula)
  const yearsUntil40 = Math.max(0, WEALTH_FORMULA_AGE_CUTOFF - averageAge);
  const expectedNetWorth =
    (averageAge * effectiveIncome) /
    (WEALTH_FORMULA_BASE_DENOMINATOR + yearsUntil40);
  const aawScore = Number(safeDivide(netWorth, expectedNetWorth) ?? 0);

  // FI Progress uses portfolio (investable assets, not home equity)
  const fiTarget = Number(safeDivide(annualExpenses, withdrawalRate) ?? 0);
  const fiProgress = Number(safeDivide(portfolioTotal + cash, fiTarget) ?? 0);

  return {
    netWorthMarket,
    netWorthCostBasis,
    netWorth,
    totalAssets,
    totalLiabilities,
    wealthScore,
    aawScore,
    fiProgress,
    fiTarget,
    warnings,
  };
}
