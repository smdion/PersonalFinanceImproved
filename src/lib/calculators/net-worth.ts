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
 * 1. **Wealth Score** (Millionaire Next Door "Wealth Accumulator" formula):
 *    Expected Net Worth = ((Age × Income) ÷ (10 + max(0, 40 - Age))) × 2
 *    - For ages 40+, denominator is 10, so expected NW = (Age × Income) / 5
 *    - For ages under 40, denominator increases (penalizes less for being young)
 *    - Score > 1.0 = "Prodigious Accumulator of Wealth" (PAW)
 *    - Score < 0.5 = "Under Accumulator of Wealth" (UAW)
 *
 * 2. **FI Progress** (Financial Independence progress):
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
  WEALTH_FORMULA_MULTIPLIER,
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
    annualSalary,
    annualExpenses,
    withdrawalRate,
    age,
  } = input;

  // Warn if mortgage exists but no home value — net worth appears artificially negative
  if (mortgageBalance > 0 && homeValueEstimated === 0 && homeValueConservative === 0) {
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

  // Wealth Score uses NW+ for the optimistic view
  // Note: Uses gross income (Millionaire Next Door formula). Dave Ramsey's variant uses take-home pay.
  const yearsUntil40 = Math.max(0, WEALTH_FORMULA_AGE_CUTOFF - age);
  const wealthTarget =
    ((age * annualSalary) / (WEALTH_FORMULA_BASE_DENOMINATOR + yearsUntil40)) *
    WEALTH_FORMULA_MULTIPLIER;
  const wealthScore = Number(safeDivide(netWorth, wealthTarget) ?? 0);

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
    wealthTarget,
    fiProgress,
    fiTarget,
    warnings,
  };
}
