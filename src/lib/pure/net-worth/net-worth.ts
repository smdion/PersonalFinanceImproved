/**
 * Net worth with the home at market value (NW+) or cost + improvements (NW-), plus
 * Wealth Score (NW ÷ lifetime earnings), AAW (Money Guy's expected NW; ≥2 PAW,
 * ≤0.5 UAW) and FI Progress (NW ÷ expenses/withdrawal rate).
 */
import type { NetWorthInput, NetWorthResult } from "./net-worth.types";
import { safeDivide } from "../../utils/math";
import {
  WEALTH_FORMULA_AGE_CUTOFF,
  WEALTH_FORMULA_BASE_DENOMINATOR,
} from "../../constants";

/**
 * A year's income for the wealth formula and lifetime earnings: gross pretax, as
 * the formula defines it. AGI only when gross wasn't recorded (AGI nets out
 * pre-tax deferrals, shrinking the target for the biggest savers).
 */
export function wealthFormulaIncome(row: {
  grossIncome: number;
  combinedAgi: number;
}): number {
  return row.grossIncome > 0 ? row.grossIncome : Math.max(0, row.combinedAgi);
}

/**
 * FI Target = Annual Expenses ÷ Withdrawal Rate — the accumulation-phase
 * "how big does my portfolio need to be" figure.
 * Single computation path: this is the only place the formula is written.
 */
function computeFiTarget(
  annualExpenses: number,
  withdrawalRate: number,
): number {
  return Number(safeDivide(annualExpenses, withdrawalRate));
}

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
  // Computed for both market and cost basis views
  const wealthScoreMarket = Number(
    safeDivide(netWorthMarket, lifetimeEarnings),
  );
  const wealthScoreCostBasis = Number(
    safeDivide(netWorthCostBasis, lifetimeEarnings),
  );

  // AAW Score: Money Guy formula — (avgAge × income) / (10 + yearsUntil40)
  // Score >= 2.0 = PAW, 1.0 = AAW, <= 0.5 = UAW (thresholds, not in formula)
  // Computed for both market and cost basis views
  const yearsUntil40 = Math.max(0, WEALTH_FORMULA_AGE_CUTOFF - averageAge);
  const expectedNetWorth =
    (averageAge * effectiveIncome) /
    (WEALTH_FORMULA_BASE_DENOMINATOR + yearsUntil40);
  const aawScoreMarket = Number(safeDivide(netWorthMarket, expectedNetWorth));
  const aawScoreCostBasis = Number(
    safeDivide(netWorthCostBasis, expectedNetWorth),
  );

  // FI Progress uses portfolio (investable assets, not home equity)
  const fiTarget = computeFiTarget(annualExpenses, withdrawalRate);
  const fiProgress = Number(safeDivide(portfolioTotal + cash, fiTarget));

  return {
    netWorthMarket,
    netWorthCostBasis,
    netWorth,
    totalAssets,
    totalLiabilities,
    wealthScoreMarket,
    wealthScoreCostBasis,
    aawScoreMarket,
    aawScoreCostBasis,
    fiProgress,
    fiTarget,
    warnings,
  };
}
